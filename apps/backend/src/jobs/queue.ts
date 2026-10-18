import { Prisma, prisma } from "@repo/db";
import { newId } from "../lib/ids.js";
import { InterviewBusyError } from "../interview/runtime-lock.js";
import { withLeaseRenewal } from "./lease.js";

export class JobDeferred extends Error {}

export async function enqueue(
  interviewId: string,
  kind: string,
  key = `${kind}:${interviewId}`,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await prisma.interviewJob.upsert({
    where: { key },
    create: {
      id: newId("job"),
      interviewId,
      kind,
      key,
      payload: payload as Prisma.InputJsonValue,
    },
    update: {},
  });
}

export class JobWorker {
  private busy = false;
  constructor(
    private readonly handlers: Record<
      string,
      (interviewId: string, payload: Record<string, unknown>) => Promise<void>
    >,
    private readonly interviewId?: string,
  ) {}

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = new Date();
      const jobs = await prisma.interviewJob.findMany({
        where: {
          interviewId: this.interviewId,
          // EVALUATE is dispatched to BullMQ by the evaluation relay; the
          // PostgreSQL poller must never claim it (see evaluation-relay.ts).
          kind: { not: "EVALUATE" },
          OR: [
            { status: "pending", runAt: { lte: now } },
            { status: "running", leaseUntil: { lt: now } },
          ],
        },
        orderBy: { runAt: "asc" },
        take: 4,
      });
      await Promise.all(
        jobs.map(async (job) => {
          const token = newId("lease");
          const claimed = await prisma.interviewJob.updateMany({
            where: {
              id: job.id,
              OR: [
                { status: "pending", runAt: { lte: now } },
                { status: "running", leaseUntil: { lt: now } },
              ],
            },
            data: {
              status: "running",
              leaseToken: token,
              leaseUntil: new Date(Date.now() + 180_000),
              attempts: { increment: 1 },
            },
          });
          if (!claimed.count) return;
          try {
            const handler = this.handlers[job.kind];
            if (!handler) throw new Error(`Unknown job kind ${job.kind}`);
            await withLeaseRenewal(
              () =>
                handler(
                  job.interviewId,
                  job.payload as Record<string, unknown>,
                ),
              () =>
                prisma.interviewJob.updateMany({
                  where: { id: job.id, leaseToken: token, status: "running" },
                  data: { leaseUntil: new Date(Date.now() + 180_000) },
                }),
            );
            await prisma.interviewJob.updateMany({
              where: { id: job.id, leaseToken: token },
              data: {
                status: "completed",
                leaseToken: null,
                leaseUntil: null,
                error: null,
              },
            });
          } catch (err) {
            if (
              err instanceof JobDeferred ||
              err instanceof InterviewBusyError
            ) {
              await prisma.interviewJob.updateMany({
                where: { id: job.id, leaseToken: token },
                data: {
                  status: "pending",
                  leaseToken: null,
                  leaseUntil: null,
                  attempts: { decrement: 1 },
                  runAt: new Date(Date.now() + 2000),
                },
              });
              return;
            }
            const exhausted = job.attempts >= 4;
            await prisma.$transaction(async (tx) => {
              const changed = await tx.interviewJob.updateMany({
                where: { id: job.id, leaseToken: token },
                data: {
                  status: exhausted ? "failed" : "pending",
                  leaseToken: null,
                  leaseUntil: null,
                  error: String(err).slice(0, 500),
                  runAt: new Date(Date.now() + 2000 * 2 ** job.attempts),
                },
              });
              if (!changed.count) return;
              if (exhausted && job.kind === "PREPARE")
                await tx.interview.updateMany({
                  where: { id: job.interviewId, status: "analyzing" },
                  data: {
                    status: "failed",
                    error: "Repository preparation failed. Please try again.",
                  },
                });
              if (exhausted && job.kind === "END")
                await tx.interview.updateMany({
                  where: { id: job.interviewId, status: "completing" },
                  data: {
                    status: "evaluation_failed",
                    error: "Evaluation failed. You can retry evaluation.",
                  },
                });
            });
          }
        }),
      );
    } finally {
      this.busy = false;
    }
  }
}
