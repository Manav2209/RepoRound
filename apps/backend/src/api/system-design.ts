import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@repo/db";
import type { ArchitectureSnapshot } from "@repo/voice-types";
import { problemSummaries, problemSummary } from "../system-design/problems.js";
import {
  getActiveSubmission,
  SubmissionError,
  submitArchitecture,
} from "../system-design/submissions.js";
import {
  normalizeSnapshot,
  submitArchitectureRequestSchema,
} from "../system-design/validation.js";
import { stateSchema } from "../interview/schemas.js";
import type { InterviewOrchestrator } from "../interview/orchestrator.js";

export function createSystemDesignCatalogRouter(): Hono {
  const app = new Hono();
  app.get("/problems", (c) => c.json({ problems: problemSummaries() }));
  return app;
}

export function createSystemDesignInterviewRouter(
  orchestrator: InterviewOrchestrator,
): Hono {
  const app = new Hono();

  app.get("/:interviewId/design", async (c) => {
    const interviewId = c.req.param("interviewId");
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: {
        mode: true,
        status: true,
        systemDesignProblemId: true,
      },
    });
    if (!interview || interview.mode !== "SYSTEM_DESIGN")
      return c.json({ error: "Interview not found" }, 404);
    const [active, runtime] = await Promise.all([
      getActiveSubmission(interviewId),
      prisma.interviewRuntime.findUnique({ where: { interviewId } }),
    ]);
    let sd: ReturnType<typeof stateSchema.parse>["systemDesign"];
    if (runtime) {
      try {
        sd = stateSchema.parse(runtime.data).systemDesign;
      } catch {
        sd = undefined;
      }
    }
    const checkpoint = sd?.checkpoint;
    const revisionAllowed = Boolean(
      checkpoint?.status === "EDITING" &&
        active?.revision === checkpoint.questionRevision,
    );
    const remainingSeconds = runtime
      ? Math.max(
          0,
          Math.ceil((runtime.deadlineAt.getTime() - Date.now()) / 1000),
        )
      : 0;
    const problem = sd?.problemSnapshot;
    return c.json({
      interviewId,
      mode: "SYSTEM_DESIGN",
      status: interview.status,
      problem: problem
        ? {
            id: problem.id,
            version: problem.version,
            title: problem.title,
            difficulty: problem.difficulty,
            brief: problem.brief,
            visibleRequirements: problem.visibleRequirements,
            loadAssumption: problem.loadAssumption,
            constraints: problem.constraints,
          }
        : problemSummary(interview.systemDesignProblemId ?? ""),
      activeRevision: active?.revision ?? 0,
      revisionAllowed,
      phase:
        sd?.phase ?? (active ? "DISCUSSION" : "DESIGN_PENDING"),
      deadlineAt: runtime?.deadlineAt.toISOString() ?? null,
      remainingSeconds,
      questionCount: sd?.questionsAsked ?? 0,
      questionTarget: sd?.questionTarget ?? 2,
      checkpoint: checkpoint
        ? {
            id: checkpoint.id,
            questionId: checkpoint.questionId,
            questionRevision: checkpoint.questionRevision,
            status: checkpoint.status,
            choice: checkpoint.choice,
            submittedRevision: checkpoint.submittedRevision,
            afterFailure: checkpoint.afterFailure,
          }
        : null,
      submission: active
        ? {
            submissionId: active.submissionId,
            revision: active.revision,
            graphStatus: active.graphStatus,
            snapshot: active.snapshot,
            createdAt: active.createdAt.toISOString(),
          }
        : null,
    });
  });

  app.post("/:interviewId/design/checkpoint", async (c) => {
    const parsed = z
      .object({
        checkpointId: z.string().min(1).max(100),
        choice: z.enum(["CONTINUE", "EDIT"]),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid checkpoint choice" }, 422);
    try {
      return c.json(
        await orchestrator.resolveCheckpoint(
          c.req.param("interviewId"),
          parsed.data.checkpointId,
          parsed.data.choice,
        ),
      );
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Checkpoint failed" },
        409,
      );
    }
  });

  app.post("/:interviewId/design/submissions", async (c) => {
    const interviewId = c.req.param("interviewId");
    const body = await c.req.json().catch(() => null);
    const parsed = submitArchitectureRequestSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { error: "Invalid architecture", details: parsed.error.flatten() },
        422,
      );
    try {
      const snapshot = normalizeSnapshot(
        parsed.data.snapshot,
      ) as ArchitectureSnapshot;
      const result = await submitArchitecture({
        interviewId,
        request: { ...parsed.data, snapshot },
      });
      if (result.revision > 1) {
        const runtime = await prisma.interviewRuntime.findUnique({
          where: { interviewId },
        });
        const checkpoint = runtime
          ? stateSchema.parse(runtime.data).systemDesign?.checkpoint
          : undefined;
        if (checkpoint?.id && result.noChange)
          await orchestrator.resolveCheckpoint(
            interviewId,
            checkpoint.id,
            "CONTINUE",
          );
        else if (checkpoint?.id && checkpoint.status === "SUBMITTED")
          await orchestrator.continueAfterCheckpoint(
            interviewId,
            checkpoint.id,
          );
      }
      return c.json(
        {
          submissionId: result.submissionId,
          revision: result.revision,
          graphStatus: result.graphStatus,
          next: result.next,
          noChange: result.noChange ?? false,
        },
        result.replayed ? 200 : 201,
      );
    } catch (err) {
      if (err instanceof SubmissionError)
        return c.json({ error: err.message }, err.status as 400);
      throw err;
    }
  });

  return app;
}
