import { afterAll, expect, test } from "bun:test";
import { Queue, Worker } from "bullmq";
import { prisma } from "@repo/db";
import { createRedisConnection } from "./redis.js";
import { EvaluationRelay, evaluationJobId } from "./evaluation-relay.js";
import { newId } from "../lib/ids.js";

// Needs both PostgreSQL (RUN_DB_TESTS) and a reachable BullMQ Redis.
const enabled = process.env.RUN_DB_TESTS === "1";
const REDIS_URL = process.env.BULLMQ_REDIS_URL ?? "redis://localhost:6380";
const QUEUE_NAME = `evaluate-test-${Date.now()}`;

async function redisAvailable(): Promise<boolean> {
  if (!enabled) return false;
  const probe = createRedisConnection(REDIS_URL);
  probe.on("error", () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe
        .ping()
        .then(() => true)
        .catch(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // QUIT queues forever when Redis is unavailable and offline queuing is on.
    probe.disconnect();
  }
}
const redisUp = await redisAvailable();
const suite = test.skipIf(!enabled || !redisUp);

const createdIds: string[] = [];

afterAll(async () => {
  if (!enabled) return;
  await prisma.interview.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
});

suite(
  "a retained failed BullMQ evaluation runs again with a fresh retry budget",
  async () => {
    const interview = await prisma.interview.create({
      data: { mode: "SYSTEM_DESIGN", status: "completing" },
    });
    createdIds.push(interview.id);
    await prisma.interviewJob.create({
      data: {
        id: newId("job"),
        interviewId: interview.id,
        kind: "EVALUATE",
        key: `EVALUATE:${interview.id}`,
        payload: {},
      },
    });
    const connection = createRedisConnection(REDIS_URL);
    const workerConnection = createRedisConnection(REDIS_URL);
    const queue = new Queue(`${QUEUE_NAME}-retry`, { connection });
    let executions = 0;
    const worker = new Worker(
      queue.name,
      async () => {
        executions++;
        if (executions === 1) throw new Error("temporary provider failure");
      },
      { connection: workerConnection },
    );
    try {
      const failed = new Promise<void>((resolve) =>
        worker.once("failed", () => resolve()),
      );
      await queue.add(
        "evaluate",
        { interviewId: interview.id },
        {
          jobId: evaluationJobId(interview.id),
          attempts: 1,
        },
      );
      await failed;
      const retained = await queue.getJob(evaluationJobId(interview.id));
      expect(await retained?.getState()).toBe("failed");
      expect(retained?.attemptsMade).toBe(1);
      const completed = new Promise<void>((resolve) =>
        worker.once("completed", () => resolve()),
      );
      await new EvaluationRelay(queue).tick();
      await completed;
      expect(executions).toBe(2);
      const recovered = await queue.getJob(evaluationJobId(interview.id));
      expect(await recovered?.getState()).toBe("completed");
      expect(recovered?.attemptsMade).toBe(1);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      workerConnection.disconnect();
      connection.disconnect();
    }
  },
  10000,
);

suite("evaluation relay -> real BullMQ transport", async () => {
  const interviewId = await new Promise<string>((resolve, reject) => {
    prisma.interview
      .create({ data: { mode: "SYSTEM_DESIGN", status: "completing" } })
      .then((row) => {
        createdIds.push(row.id);
        resolve(row.id);
      })
      .catch(reject);
  });
  await prisma.interviewJob.create({
    data: {
      id: newId("job"),
      interviewId,
      kind: "EVALUATE",
      key: `EVALUATE:${interviewId}`,
      payload: {},
    },
  });

  const queueConnection = createRedisConnection(REDIS_URL);
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });
  const workerConnection = createRedisConnection(REDIS_URL);
  const received: string[] = [];
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      received.push(job.data.interviewId);
    },
    { connection: workerConnection, concurrency: 1 },
  );

  try {
    const relay = new EvaluationRelay(queue);
    await relay.tick();
    await relay.tick();

    const settled = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      const check = setInterval(() => {
        if (received.length) {
          clearInterval(check);
          clearTimeout(timer);
          resolve(true);
        }
      }, 50);
    });
    expect(settled).toBe(true);

    // The intent was marked dispatched on the first tick, so the second tick
    // publishes nothing: stable jobId plus state gating yields exactly one job.
    expect(received).toEqual([interviewId]);
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    workerConnection.disconnect();
    queueConnection.disconnect();
  }
});
