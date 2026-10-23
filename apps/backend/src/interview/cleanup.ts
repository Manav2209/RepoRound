import { prisma } from "@repo/db";
import { designGraphStore } from "../system-design/graph.js";
import { memoryGraphStore } from "./memory-graph.js";
import { InterviewBusyError, withInterviewLock } from "./runtime-lock.js";

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
        if (interview.status !== "completed" || interview.evaluation?.status !== "completed") continue;
        if (interview.jobs.some((job) => job.status !== "completed")) continue;
        await withInterviewLock(intent.interviewId, async () => {
          const current = await prisma.interview.findUnique({
            where: { id: intent.interviewId },
            select: { status: true, designSubmissions: { select: { id: true } } },
          });
          if (current?.status !== "completed") return;
          await memoryGraphStore().remove(intent.interviewId);
          for (const submission of current.designSubmissions)
            await designGraphStore().removeSubmission(submission.id);
          await prisma.interview.delete({ where: { id: intent.interviewId } });
        });
      } else {
        // The graph deletes happened before the PostgreSQL tree was removed.
        await memoryGraphStore().remove(intent.interviewId);
      }
      await prisma.interviewCleanup.deleteMany({ where: { interviewId: intent.interviewId } });
    } catch (error) {
      if (error instanceof InterviewBusyError) continue;
      await prisma.interviewCleanup.updateMany({
        where: { interviewId: intent.interviewId },
        data: {
          attempts: { increment: 1 },
          error: String(error).slice(0, 500),
        },
      });
      console.error("[interview-cleanup] retry pending", intent.interviewId, error);
    }
  }
}
