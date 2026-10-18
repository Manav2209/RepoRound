import { prisma } from "@repo/db";
import { newId } from "../lib/ids.js";
import { JobDeferred } from "./queue.js";

export const EVALUATION_QUEUE = "evaluate";

/** Stable BullMQ job ID: no colons, one logical evaluation per interview. */
export function evaluationJobId(interviewId: string): string {
  return `eval-${interviewId}-v1`;
}

const CLAIM_LEASE_MS = 60_000;
const RECONCILE_AFTER_MS = 120_000;
const MAX_DISPATCH_ATTEMPTS = 6;

export interface EvaluationQueue {
  getJob(id: string): Promise<
    | {
        getState(): Promise<string>;
        retry(
          state: "failed",
          options: {
            resetAttemptsMade: boolean;
            resetAttemptsStarted: boolean;
          },
        ): Promise<void>;
      }
    | undefined
  >;
  add(
    name: string,
    data: { interviewId: string },
    options: {
      jobId: string;
      removeOnComplete: boolean;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
    },
  ): Promise<unknown>;
}

/**
 * PostgreSQL `InterviewJob(kind='EVALUATE')` is the durable dispatch intent.
 * The relay claims pending intents with a lease CAS and publishes them to
 * BullMQ. On Redis outage it leaves the intent pending so nothing is lost.
 */
export class EvaluationRelay {
  private busy = false;
  constructor(
    private readonly queue: EvaluationQueue,
    private readonly prerequisite?: (interviewId: string) => Promise<void>,
  ) {}

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.dispatchPending();
      await this.reconcile();
    } finally {
      this.busy = false;
    }
  }

  private async dispatchPending(): Promise<void> {
    const now = new Date();
    const intents = await prisma.interviewJob.findMany({
      where: {
        kind: "EVALUATE",
        OR: [
          { status: "pending", runAt: { lte: now } },
          { status: "relaying", leaseUntil: { lt: now } },
        ],
      },
      orderBy: { runAt: "asc" },
      take: 10,
    });
    for (const intent of intents) {
      const token = newId("relay");
      const claimed = await prisma.interviewJob.updateMany({
        where: {
          id: intent.id,
          OR: [
            { status: "pending", runAt: { lte: now } },
            { status: "relaying", leaseUntil: { lt: now } },
          ],
        },
        data: {
          status: "relaying",
          leaseToken: token,
          leaseUntil: new Date(Date.now() + CLAIM_LEASE_MS),
        },
      });
      if (!claimed.count) continue;
      try {
        const interview = await prisma.interview.findUnique({
          where: { id: intent.interviewId },
          select: { mode: true },
        });
        if (!interview) {
          await this.settle(intent.id, token, "failed", "Interview missing");
          continue;
        }
        if (interview.mode === "GITHUB" && this.prerequisite)
          await this.prerequisite(intent.interviewId);
        const jobId = evaluationJobId(intent.interviewId);
        const existing = await this.queue.getJob(jobId);
        if (existing && (await existing.getState()) === "failed") {
          // Queue.add deduplicates retained failures; an explicit retry must
          // restore their full attempt budget instead.
          await existing.retry("failed", {
            resetAttemptsMade: true,
            resetAttemptsStarted: true,
          });
        } else
          await this.queue.add(
            "evaluate",
            { interviewId: intent.interviewId },
            {
              jobId,
              removeOnComplete: true,
              attempts: 4,
              backoff: { type: "exponential", delay: 5000 },
            },
          );
        await this.settle(intent.id, token, "dispatched", null, true);
      } catch (err) {
        // JobDeferred: repository recovery still running. Redis outage: keep
        // the intent so a later relay tick retries. Either way, stay pending.
        if (!(err instanceof JobDeferred))
          console.error(
            `[evaluation-relay] dispatch failed for ${intent.interviewId}`,
            err,
          );
        await prisma.interviewJob.updateMany({
          where: { id: intent.id, leaseToken: token },
          data: {
            status: "pending",
            leaseToken: null,
            leaseUntil: null,
            runAt: new Date(Date.now() + 3000),
          },
        });
      }
    }
  }

  /**
   * Re-enqueue stale `dispatched` intents whose evaluation never completed.
   * BullMQ de-duplication is not a forever guarantee across restarts.
   */
  private async reconcile(): Promise<void> {
    const stale = await prisma.interviewJob.findMany({
      where: {
        kind: "EVALUATE",
        status: "dispatched",
        runAt: { lte: new Date(Date.now() - RECONCILE_AFTER_MS) },
      },
      take: 10,
    });
    for (const job of stale) {
      const evaluation = await prisma.evaluation.findUnique({
        where: { interviewId: job.interviewId },
        select: { status: true },
      });
      if (evaluation?.status === "completed") {
        await prisma.interviewJob.updateMany({
          where: { id: job.id },
          data: { status: "completed", error: null },
        });
        continue;
      }
      const interview = await prisma.interview.findUnique({
        where: { id: job.interviewId },
        select: { status: true },
      });
      if (
        !interview ||
        !["completing", "evaluation_failed"].includes(interview.status)
      )
        continue;
      if (job.attempts >= MAX_DISPATCH_ATTEMPTS) {
        await prisma.$transaction(async (tx) => {
          await tx.interviewJob.updateMany({
            where: { id: job.id },
            data: {
              status: "failed",
              error: "Evaluation dispatch attempts exhausted",
            },
          });
          await tx.interview.updateMany({
            where: { id: job.interviewId, status: "completing" },
            data: {
              status: "evaluation_failed",
              error: "Evaluation failed. You can retry evaluation.",
            },
          });
        });
        continue;
      }
      await prisma.interviewJob.updateMany({
        where: { id: job.id, status: "dispatched" },
        data: { status: "pending", runAt: new Date() },
      });
    }
  }

  private async settle(
    id: string,
    token: string,
    status: "dispatched" | "failed",
    error: string | null,
    countAttempt = false,
  ): Promise<void> {
    await prisma.interviewJob.updateMany({
      where: { id, leaseToken: token },
      data: {
        status,
        error,
        leaseToken: null,
        leaseUntil: null,
        runAt: new Date(),
        ...(countAttempt ? { attempts: { increment: 1 } } : {}),
      },
    });
  }
}
