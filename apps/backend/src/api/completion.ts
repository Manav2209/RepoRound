import { Hono } from "hono";
import type { EvaluationService } from "../evaluation/evaluation.service.js";
import { interviewRepo } from "../db/repositories/interview.repo.js";
import { prisma } from "@repo/db";

export function createCompletionRouter(evaluations: EvaluationService): Hono {
  const app = new Hono();

  /**
   * Ends an interview: marks it completing, runs (+stores) evaluation, then
   * marks the interview completed and closes the realtime session.
   */
  app.post("/:interviewId/end", async (c) => {
    const { interviewId } = c.req.param();

    const interview = await interviewRepo.getById(interviewId);
    if (!interview) {
      return c.json({ error: "Interview not found" }, 404);
    }
    if (
      interview.status !== "active" &&
      interview.status !== "completing" &&
      interview.status !== "completed"
    ) {
      return c.json(
        { error: `Interview cannot be ended from status=${interview.status}` },
        409,
      );
    }

    const evaluation = await evaluations.finalize(interviewId);

    return c.json({
      interviewId,
      status:
        evaluation.status === "pending"
          ? "completing"
          : evaluation.status === "failed"
            ? "evaluation_failed"
            : "completed",
      evaluationStatus: evaluation.status,
    });
  });

  app.post("/:interviewId/evaluation/retry", async (c) => {
    if (await prisma.report.findUnique({ where: { interviewId: c.req.param("interviewId") } }))
      return c.json({ error: "Report is final; start a new interview" }, 409);
    await evaluations.retry(c.req.param("interviewId"));
    return c.json({ status: "completing" });
  });
  return app;
}
