import { Hono } from "hono";
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

export function createSystemDesignCatalogRouter(): Hono {
  const app = new Hono();
  app.get("/problems", (c) => c.json({ problems: problemSummaries() }));
  return app;
}

export function createSystemDesignInterviewRouter(): Hono {
  const app = new Hono();

  app.get("/:interviewId/design", async (c) => {
    const interviewId = c.req.param("interviewId");
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: { mode: true, systemDesignProblemId: true },
    });
    if (!interview || interview.mode !== "SYSTEM_DESIGN")
      return c.json({ error: "Interview not found" }, 404);
    const active = await getActiveSubmission(interviewId);
    let revisionAllowed = false;
    const runtime = await prisma.interviewRuntime.findUnique({
      where: { interviewId },
    });
    if (runtime) {
      try {
        const state = stateSchema.parse(runtime.data);
        revisionAllowed =
          active?.revision === 1 &&
          state.systemDesign?.phase === "REVISION_REQUESTED";
      } catch {
        revisionAllowed = false;
      }
    }
    return c.json({
      interviewId,
      mode: "SYSTEM_DESIGN",
      problem: problemSummary(interview.systemDesignProblemId ?? ""),
      activeRevision: active?.revision ?? 0,
      revisionAllowed,
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
      return c.json(
        {
          submissionId: result.submissionId,
          revision: result.revision,
          graphStatus: result.graphStatus,
          next: result.next,
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
