import { Hono } from "hono";
import { evaluationRepo } from "../db/repositories/evaluation.repo.js";
import { interviewRepo } from "../db/repositories/interview.repo.js";
import { prisma } from "@repo/db";
import { problemSummary } from "../system-design/problems.js";

export function createResultsRouter(): Hono {
  const app = new Hono();
  app.get("/:interviewId/transcript", async (c) => {
    const turns = await prisma.conversationTurn.findMany({
      where: { interviewId: c.req.param("interviewId") },
      orderBy: [{ completedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        role: true,
        text: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return c.json(
      turns.map((t) => ({
        id: t.id,
        role: t.role,
        text: t.text,
        timestamp: (t.completedAt ?? t.createdAt).getTime(),
        final: true,
      })),
    );
  });

  app.get("/:interviewId/result", async (c) => {
    const { interviewId } = c.req.param();

    const interview = await interviewRepo.getById(interviewId);
    if (!interview) {
      return c.json({ error: "Interview not found" }, 404);
    }

    const evaluation = await evaluationRepo.getForInterview(interviewId);
    const turns = await prisma.conversationTurn.findMany({
      where: { interviewId, role: "user" },
      select: { questionId: true, analysisStatus: true },
    });
    const summary = {
      repository:
        interview.owner && interview.name
          ? `${interview.owner}/${interview.name}`
          : (problemSummary(interview.systemDesignProblemId ?? "")?.title ??
            "System design interview"),
      candidateTurns: turns.length,
      answeredQuestions: new Set(turns.map((t) => t.questionId).filter(Boolean))
        .size,
      analyzedTurns: turns.filter((t) => t.analysisStatus === "completed")
        .length,
      failedAnalyses: turns.filter((t) => t.analysisStatus === "failed").length,
      durationSeconds: interview.startedAt
        ? Math.max(
            0,
            Math.round(
              ((
                interview.completedAt ??
                evaluation?.createdAt ??
                new Date()
              ).getTime() -
                interview.startedAt.getTime()) /
                1000,
            ),
          )
        : null,
    };
    if (
      !evaluation ||
      interview.status !== "completed" ||
      evaluation.status !== "completed"
    ) {
      return c.json({
        status: interview.status,
        message: "Evaluation not available yet",
        summary,
      });
    }

    const completed = await prisma.interviewEvent.findFirst({
      where: { interviewId, type: "evaluation.completed" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { payload: true },
    });
    const coverage = (completed?.payload as { coverage?: unknown } | null)
      ?.coverage;
    return c.json({
      status: evaluation.status,
      ...(coverage ? { coverage } : {}),
      score: evaluation.score,
      dimensions: evaluation.dimensions as unknown as Record<
        string,
        number | null
      >,
      evidence: evaluation.evidence,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      feedback: evaluation.feedback,
      summary,
    });
  });

  return app;
}
