import { prisma } from "@repo/db";
import { designGraphStore } from "../system-design/graph.js";
import { memoryGraphStore } from "./memory-graph.js";
import { InterviewBusyError, withInterviewLock } from "./runtime-lock.js";
import { snapshotInterviewMetrics } from "../observability/metrics.js";

/** Idempotent cleanup intent survives deletion of the interview tree. */
export async function reconcileInterviewCleanup(): Promise<void> {
  const intents = await prisma.interviewCleanup.findMany({
    where: { status: "pending" },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });
  for (const intent of intents) {
    try {
      const interview = await prisma.interview.findUnique({
        where: { id: intent.interviewId },
        select: {
          id: true,
          status: true,
          evaluation: { select: { status: true } },
          jobs: { where: { kind: "EVALUATE" }, select: { status: true } },
          designSubmissions: { select: { id: true } },
        },
      });
      if (interview) {
        if (
          interview.status !== "completed" ||
          interview.evaluation?.status !== "completed"
        )
          continue;
        if (interview.jobs.some((job) => job.status !== "completed")) continue;
        await withInterviewLock(intent.interviewId, async () => {
          const current = await prisma.interview.findUnique({
            where: { id: intent.interviewId },
            select: {
              status: true,
              completedAt: true,
              designSubmissions: { select: { id: true } },
            },
          });
          if (current?.status !== "completed") return;
          // Archive while holding the runtime lock, including during a deferred
          // cleanup, so a metrics read cannot overwrite the final snapshot.
          const metrics = await snapshotInterviewMetrics(intent.interviewId);
          const voiceEvent = await prisma.interviewEvent.findFirst({
            where: {
              interviewId: intent.interviewId,
              type: { startsWith: "voice." },
            },
            select: { id: true },
          });
          if (
            voiceEvent &&
            !metrics?.workerClosureReceived &&
            Date.now() - (current.completedAt ?? intent.createdAt).getTime() <
              30_000
          )
            return; // Let closing-speech metrics and the worker journal drain.
          // Save operational numbers before deleting raw turns and event traces.
          // If archiving fails, retry cleanup rather than losing the evidence.
          await memoryGraphStore().remove(intent.interviewId);
          for (const submission of current.designSubmissions)
            await designGraphStore().removeSubmission(submission.id);
          await prisma.interview.delete({ where: { id: intent.interviewId } });
          await prisma.interviewCleanup.deleteMany({
            where: { interviewId: intent.interviewId },
          });
        });
        // A deferred cleanup keeps its intent for the next reconciliation.
        if (
          await prisma.interview.findUnique({
            where: { id: intent.interviewId },
            select: { id: true },
          })
        )
          continue;
      } else {
        // The graph deletes happened before the PostgreSQL tree was removed.
        await memoryGraphStore().remove(intent.interviewId);
      }
      await prisma.interviewCleanup.deleteMany({
        where: { interviewId: intent.interviewId },
      });
    } catch (error) {
      if (error instanceof InterviewBusyError) continue;
      await prisma.interviewCleanup.updateMany({
        where: { interviewId: intent.interviewId },
        data: {
          attempts: { increment: 1 },
          error: String(error).slice(0, 500),
        },
      });
      console.error(
        "[interview-cleanup] retry pending",
        intent.interviewId,
        error,
      );
    }
  }
}
