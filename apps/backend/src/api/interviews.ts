import { Hono } from "hono";
import { z } from "zod";
import type { InterviewService } from "../interview/interview.service.js";
import { getProblem } from "../system-design/problems.js";
import { getActiveSubmission } from "../system-design/submissions.js";
import { GithubScraperError } from "../github/github.scraper.js";
import { serverError } from "./errors.js";
import { prisma } from "@repo/db";
import { problemSummary } from "../system-design/problems.js";

const createInterviewSchema = z.union([
  z.object({ githubUrl: z.string().min(1).max(2048) }),
  z.object({
    mode: z.literal("SYSTEM_DESIGN"),
    problemId: z.string().min(1).max(100),
  }),
]);

export function createInterviewsRouter(service: InterviewService): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const interviews = await prisma.interview.findMany({
      where: { userId: c.get("userId"), status: "completed" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        mode: true,
        owner: true,
        name: true,
        systemDesignProblemId: true,
        completedAt: true,
        evaluation: { select: { score: true } },
      },
    });
    return c.json({
      reports: interviews.map((interview) => ({
        interviewId: interview.id,
        mode: interview.mode,
        title:
          interview.mode === "SYSTEM_DESIGN"
            ? (problemSummary(interview.systemDesignProblemId ?? "")?.title ??
              "System design interview")
            : interview.owner && interview.name
              ? `${interview.owner}/${interview.name}`
              : "Repository interview",
        score: interview.evaluation?.score ?? null,
        completedAt: interview.completedAt,
      })),
    });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createInterviewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      if ("githubUrl" in parsed.data) {
        const { id, status } = await service.create(
          parsed.data.githubUrl,
          c.get("userId"),
        );
        return c.json({ interviewId: id, mode: "GITHUB", status }, 201);
      }
      if (!getProblem(parsed.data.problemId))
        return c.json({ error: "Unknown system design problem" }, 400);
      const { id, status } = await service.createSystemDesign(
        parsed.data.problemId,
        c.get("userId"),
      );
      return c.json({ interviewId: id, mode: "SYSTEM_DESIGN", status }, 201);
    } catch (err) {
      if (err instanceof GithubScraperError)
        return c.json({ error: err.message }, 400);
      return serverError(c, err);
    }
  });

  app.get("/:id", async (c) => {
    const { id } = c.req.param();
    const interview = await service.getById(id);
    if (!interview) {
      return c.json({ error: "Interview not found" }, 404);
    }
    if (interview.mode === "SYSTEM_DESIGN") {
      const active = await getActiveSubmission(interview.id);
      return c.json({
        interviewId: interview.id,
        mode: "SYSTEM_DESIGN",
        status: interview.status,
        problemId: interview.systemDesignProblemId,
        error: interview.error ?? undefined,
        createdAt: interview.createdAt,
        preparationStage: active ? "ready" : "designing",
      });
    }
    return c.json({
      interviewId: interview.id,
      mode: "GITHUB",
      status: interview.status,
      githubUrl: interview.githubUrl,
      error: interview.error ?? undefined,
      createdAt: interview.createdAt,
      preparationStage: interview.interviewPlan
        ? "ready"
        : interview.knowledge
          ? "planning"
          : "analyzing",
    });
  });

  return app;
}
