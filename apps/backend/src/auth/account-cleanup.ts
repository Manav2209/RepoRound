import { prisma } from "@repo/db";
import { designGraphStore } from "../system-design/graph.js";

export async function removeUserDesignGraphs(userId: string): Promise<void> {
  const interviews = await prisma.interview.findMany({
    where: { userId },
    select: {
      id: true,
      designSubmissions: { select: { id: true } },
    },
  });

  for (const interview of interviews) {
    for (const submission of interview.designSubmissions) {
      await designGraphStore().removeSubmission(submission.id);
    }
  }
}
