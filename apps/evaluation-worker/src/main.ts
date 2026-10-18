import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@repo/db";
import {
  EvaluationService,
  LlmClient,
  loadWorkerConfig,
} from "@repo/backend/evaluation";
import { EVALUATION_QUEUE } from "@repo/backend/jobs/evaluation-relay";
import { createRedisConnection } from "@repo/backend/jobs/redis";
import { EvaluationRunner, type EvaluationJobData } from "./evaluate.js";
import { logEvaluation } from "./observability.js";

const config = loadWorkerConfig();
const runner = new EvaluationRunner(
  new EvaluationService(new LlmClient(config)),
);

const worker = new Worker<EvaluationJobData>(
  EVALUATION_QUEUE,
  async (job) => {
    await runner.run(job.data);
  },
  {
    connection: createRedisConnection(config.BULLMQ_REDIS_URL),
    concurrency: config.EVALUATION_WORKER_CONCURRENCY,
  },
);

worker.on("ready", () =>
  logEvaluation("worker.ready", { queue: EVALUATION_QUEUE }),
);

worker.on("failed", (job, err) => {
  if (!job) return;
  const attempts = job.opts.attempts ?? 1;
  logEvaluation("job.failed", {
    interviewId: job.data.interviewId,
    attemptsMade: job.attemptsMade,
    error: err.message,
  });
  if (job.attemptsMade >= attempts) {
    void runner
      .markFailed(job.data, err.message)
      .then(() =>
        prisma.interview.updateMany({
          where: { id: job.data.interviewId, status: "completing" },
          data: {
            status: "evaluation_failed",
            error: "Evaluation failed. You can retry evaluation.",
          },
        }),
      )
      .catch((cause: unknown) =>
        console.error("[evaluation-worker] failure settling failed", cause),
      );
  }
});

worker.on("error", (err) =>
  console.error("[evaluation-worker] worker error", err),
);

logEvaluation("worker.started", {
  queue: EVALUATION_QUEUE,
  concurrency: config.EVALUATION_WORKER_CONCURRENCY,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logEvaluation("worker.shutdown", { signal });
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
