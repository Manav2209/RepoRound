import { afterAll, describe, expect, test } from "bun:test";
import { prisma } from "@repo/db";
import {
  EvaluationRelay,
  evaluationJobId,
  type EvaluationQueue,
} from "./evaluation-relay.js";
import { JobDeferred, JobWorker } from "./queue.js";
import { newId } from "../lib/ids.js";

const enabled = process.env.RUN_DB_TESTS === "1";
const describeLive = describe.skipIf(!enabled);

class FakeQueue implements EvaluationQueue {
  fail = false;
  readonly adds: {
    name: string;
    data: { interviewId: string };
    jobId: string;
  }[] = [];
  async getJob() {
    return undefined;
  }
  async add(
    name: string,
    data: { interviewId: string },
    options: { jobId: string },
  ): Promise<unknown> {
    if (this.fail) throw new Error("redis unavailable");
    this.adds.push({ name, data, jobId: options.jobId });
    return {};
  }
}

const createdIds: string[] = [];

async function makeInterview(
  mode: "GITHUB" | "SYSTEM_DESIGN",
): Promise<string> {
  const interview = await prisma.interview.create({
    data: { mode, status: "completing" },
  });
  createdIds.push(interview.id);
  return interview.id;
}

async function makeIntent(
  interviewId: string,
  overrides: { status?: string; attempts?: number; runAt?: Date } = {},
): Promise<string> {
  const job = await prisma.interviewJob.create({
    data: {
      id: newId("job"),
      interviewId,
      kind: "EVALUATE",
      key: `EVALUATE:${interviewId}`,
      payload: {},
      status: overrides.status ?? "pending",
      attempts: overrides.attempts ?? 0,
      runAt: overrides.runAt ?? new Date(),
    },
  });
  return job.id;
}

afterAll(async () => {
  if (!enabled) return;
  await prisma.interview.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
});

describeLive("relay dispatch", async () => {
  test("an expired relay lease is reclaimed after a backend crash", async () => {
    const interviewId = await makeInterview("SYSTEM_DESIGN");
    const id = await makeIntent(interviewId, { status: "relaying" });
    await prisma.interviewJob.update({
      where: { id },
      data: { leaseToken: "crashed", leaseUntil: new Date(Date.now() - 1000) },
    });
    const queue = new FakeQueue();
    await new EvaluationRelay(queue).tick();
    expect(queue.adds.map((job) => job.data.interviewId)).toContain(
      interviewId,
    );
    const job = await prisma.interviewJob.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("dispatched");
    expect(job.leaseToken).toBeNull();
  });

  test("an unexpired relay lease cannot be taken by another backend", async () => {
    const interviewId = await makeInterview("SYSTEM_DESIGN");
    const id = await makeIntent(interviewId, { status: "relaying" });
    await prisma.interviewJob.update({
      where: { id },
      data: { leaseToken: "working", leaseUntil: new Date(Date.now() + 60000) },
    });
    const queue = new FakeQueue();
    await new EvaluationRelay(queue).tick();
    expect(queue.adds.some((job) => job.data.interviewId === interviewId)).toBe(
      false,
    );
    expect(
      (await prisma.interviewJob.findUniqueOrThrow({ where: { id } }))
        .leaseToken,
    ).toBe("working");
  });

  test("a pending intent is published once and marked dispatched", async () => {
    const interviewId = await makeInterview("SYSTEM_DESIGN");
    await makeIntent(interviewId);
    const queue = new FakeQueue();
    await new EvaluationRelay(queue).tick();

    expect(queue.adds).toHaveLength(1);
    expect(queue.adds[0]!.jobId).toBe(evaluationJobId(interviewId));
    const job = await prisma.interviewJob.findFirstOrThrow({
      where: { interviewId, kind: "EVALUATE" },
    });
    expect(job.status).toBe("dispatched");
    expect(job.attempts).toBe(1);
  });

  test("a Redis outage keeps the durable intent pending", async () => {
    const interviewId = await makeInterview("SYSTEM_DESIGN");
    await makeIntent(interviewId);
    const queue = new FakeQueue();
    queue.fail = true;
    await new EvaluationRelay(queue).tick();

    const job = await prisma.interviewJob.findFirstOrThrow({
      where: { interviewId, kind: "EVALUATE" },
    });
    expect(job.status).toBe("pending");
    expect(job.leaseToken).toBeNull();
  });

  test("deferred GitHub prerequisites leave the intent pending; SD skips them", async () => {
    const github = await makeInterview("GITHUB");
    await makeIntent(github);
    const queue = new FakeQueue();
    const relay = new EvaluationRelay(queue, async () => {
      throw new JobDeferred("waiting for analysis");
    });
    await relay.tick();
    const githubJob = await prisma.interviewJob.findFirstOrThrow({
      where: { interviewId: github, kind: "EVALUATE" },
    });
    expect(githubJob.status).toBe("pending");
    expect(queue.adds).toHaveLength(0);

    const sd = await makeInterview("SYSTEM_DESIGN");
    await makeIntent(sd);
    let prerequisiteCalls = 0;
    const sdQueue = new FakeQueue();
    await new EvaluationRelay(sdQueue, async () => {
      prerequisiteCalls += 1;
    }).tick();
    expect(prerequisiteCalls).toBe(0);
    expect(sdQueue.adds).toHaveLength(1);
  });

  test("an EVALUATE intent is never claimed by the PostgreSQL poller", async () => {
    const interviewId = await makeInterview("SYSTEM_DESIGN");
    await makeIntent(interviewId);
    let handled = false;
    const poller = new JobWorker({
      EVALUATE: async () => {
        handled = true;
      },
    });
    await poller.tick();
    expect(handled).toBe(false);
    const job = await prisma.interviewJob.findFirstOrThrow({
      where: { interviewId, kind: "EVALUATE" },
    });
    expect(job.status).toBe("pending");
  });
});

describeLive("relay reconciliation", async () => {
  test("stale dispatched intents are re-queued while evaluation is incomplete", async () => {
    const interviewId = await makeInterview("SYSTEM_DESIGN");
    await makeIntent(interviewId, {
      status: "dispatched",
      attempts: 1,
      runAt: new Date(Date.now() - 10 * 60_000),
    });
    await new EvaluationRelay(new FakeQueue()).tick();
    const job = await prisma.interviewJob.findFirstOrThrow({
      where: { interviewId, kind: "EVALUATE" },
    });
    expect(job.status).toBe("pending");
  });

  test("completed evaluations settle the intent without re-dispatching", async () => {
    const interviewId = await makeInterview("SYSTEM_DESIGN");
    await makeIntent(interviewId, {
      status: "dispatched",
      attempts: 1,
      runAt: new Date(Date.now() - 10 * 60_000),
    });
    await prisma.evaluation.create({
      data: {
        interviewId,
        dimensions: {},
        strengths: [],
        weaknesses: [],
        feedback: "done",
        status: "completed",
      },
    });
    await new EvaluationRelay(new FakeQueue()).tick();
    const job = await prisma.interviewJob.findFirstOrThrow({
      where: { interviewId, kind: "EVALUATE" },
    });
    expect(job.status).toBe("completed");
  });

  test("exhausted dispatch attempts mark the interview evaluation_failed", async () => {
    const interviewId = await makeInterview("SYSTEM_DESIGN");
    await makeIntent(interviewId, {
      status: "dispatched",
      attempts: 6,
      runAt: new Date(Date.now() - 10 * 60_000),
    });
    await new EvaluationRelay(new FakeQueue()).tick();
    const job = await prisma.interviewJob.findFirstOrThrow({
      where: { interviewId, kind: "EVALUATE" },
    });
    expect(job.status).toBe("failed");
    const interview = await prisma.interview.findUniqueOrThrow({
      where: { id: interviewId },
    });
    expect(interview.status).toBe("evaluation_failed");
  });
});
