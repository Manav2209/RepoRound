import { prisma } from "@repo/db";
import { designGraphStore } from "../system-design/graph.js";
import { memoryGraphStore } from "../interview/memory-graph.js";
import { activeSessions } from "../interview/active-sessions.js";

export async function removeUserDesignGraphs(userId: string): Promise<void> {
  activeSessions.evictUser(userId);
  const interviews = await prisma.interview.findMany({
    where: { userId },
    select: {
      id: true,
      designSubmissions: { select: { id: true } },
    },
  });

  for (const interview of interviews) {
    await memoryGraphStore().remove(interview.id);
    for (const submission of interview.designSubmissions) {
      await designGraphStore().removeSubmission(submission.id);
    }
  }
}
