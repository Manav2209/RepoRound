import { Hono } from "hono";
import { z } from "zod";
import type { BackendConfig } from "../config.js";
import { internalAuthFromConfig, rateLimit } from "./security.js";
import {
  RealtimeEventService,
  realtimeEventSchema,
  requireSession,
} from "../realtime/events.js";
import { interviewRepo } from "../db/repositories/interview.repo.js";
import type { InterviewOrchestrator } from "../interview/orchestrator.js";
import type { EvaluationService } from "../evaluation/evaluation.service.js";
import { InterviewBusyError } from "../interview/runtime-lock.js";
import { prisma } from "@repo/db";
import { readGithubContext } from "../github/context.js";
import { stateSchema } from "../interview/schemas.js";
import {
  activeSessions,
  ActiveSessionLostError,
} from "../interview/active-sessions.js";

const id = z.string().min(1).max(100);
export function createInternalRouter(
  config: BackendConfig,
  events: RealtimeEventService,
  orchestrator: InterviewOrchestrator,
  evaluations: EvaluationService,
): Hono {
  const app = new Hono();
  app.use("*", internalAuthFromConfig(config));
  app.onError((err, c) => {
    if (err instanceof DOMException && err.name === "AbortError")
      return c.json({ error: "Turn cancelled" }, 409);
    if (err instanceof ActiveSessionLostError)
      return c.json({ error: err.message }, 410);
    if (err instanceof InterviewBusyError) {
      c.header("Retry-After", "1");
      return c.json({ error: "Interview is processing another event" }, 503);
    }
    if (err instanceof z.ZodError)
      return c.json({ error: "Invalid request" }, 400);
    console.error("Internal interview operation failed", err);
    return c.json({ error: "Interview operation failed" }, 500);
  });
  app.get("/context/:interviewId", async (c) => {
    const sessionId = c.req.query("sessionId");
    if (!sessionId) return c.json({ error: "Session required" }, 400);
    await requireSession(c.req.param("interviewId"), sessionId);
    const interview = await interviewRepo.getWithContext(
      c.req.param("interviewId"),
    );
    if (!interview) return c.json({ error: "Interview not found" }, 404);
    const context = readGithubContext(interview.knowledge?.facts);
    return c.json({
      interviewId: interview.id,
      sessionId,
      githubContext: context
        ? {
            repository: context.repository,
            projectSummary: context.projectSummary,
          }
        : null,
      interview: { status: interview.status },
    });
  });
  app.post("/realtime/events", async (c) => {
    const parsed = realtimeEventSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: "Invalid event" }, 400);
    const memory = activeSessions.peek(parsed.data.interviewId);
    if (
      !(memory
        ? activeSessions.admitEvent(memory.interviewId, parsed.data.sessionId)
        : await rateLimit(`agent:${parsed.data.sessionId}`, 180, 60_000))
    )
      return c.json({ error: "Too many events" }, 429);
    return c.json({ ok: true, ...(await events.process(parsed.data)) });
  });
  app.post("/interviews/:interviewId/start", async (c) => {
    const parsed = z
      .object({ sessionId: id })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Session required" }, 400);
    return c.json(
      await orchestrator.start(
        c.req.param("interviewId"),
        parsed.data.sessionId,
      ),
    );
  });
  app.post("/interviews/:interviewId/turns", async (c) => {
    const parsed = z
      .object({
        sessionId: id,
        turnId: id,
        questionId: id,
        text: z.string().trim().min(1).max(10000),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid final candidate turn" }, 400);
    const memory = activeSessions.peek(c.req.param("interviewId"));
    if (
      !(memory
        ? activeSessions.admitTurn(memory.interviewId, parsed.data.sessionId)
        : await rateLimit(`turn:${parsed.data.sessionId}`, 30, 60_000))
    )
      return c.json({ error: "Too many turns" }, 429);
    const result = await orchestrator.processTurn({
      interviewId: c.req.param("interviewId"),
      ...parsed.data,
    });
    if (result.ended) await evaluations.finalize(c.req.param("interviewId"));
    return c.json(result);
  });
  app.post("/interviews/:interviewId/turns/:turnId/cancel", async (c) => {
    const body = z.object({ sessionId: id }).parse(await c.req.json());
    await requireSession(c.req.param("interviewId"), body.sessionId);
    activeSessions.cancel(c.req.param("interviewId"), c.req.param("turnId"));
    return c.json({ ok: true });
  });
  app.get("/interviews/:interviewId/status", async (c) => {
    await requireSession(
      c.req.param("interviewId"),
      c.req.query("sessionId") ?? "",
    );
    const memory = activeSessions.peek(c.req.param("interviewId"));
    if (memory)
      return c.json({
        ended:
          memory.state.ended ||
          memory.frozen ||
          !memory.connected ||
          memory.deadlineAt <= new Date(),
        deadlineAt: memory.deadlineAt.toISOString(),
      });
    const interview = await prisma.interview.findUniqueOrThrow({
      where: { id: c.req.param("interviewId") },
      include: { runtime: true },
    });
    return c.json({
      ended:
        interview.status !== "active" ||
        Boolean((interview.runtime?.data as { ended?: boolean } | null)?.ended),
      deadlineAt: interview.runtime?.deadlineAt.toISOString(),
    });
  });
  app.get("/interviews/:interviewId/pending", async (c) => {
    await requireSession(
      c.req.param("interviewId"),
      c.req.query("sessionId") ?? "",
    );
    const memory = activeSessions.peek(c.req.param("interviewId"));
    if (memory)
      return c.json({
        ended: memory.state.ended || memory.frozen || !memory.connected,
        questionId: null,
        question: null,
        deadlineAt: memory.deadlineAt.toISOString(),
      });
    const runtime = await prisma.interviewRuntime.findUnique({
      where: { interviewId: c.req.param("interviewId") },
    });
    if (!runtime)
      return c.json({ ended: true, questionId: null, question: null });
    try {
      const state = stateSchema.parse(runtime.data);
      const sd = state.systemDesign;
      const question = sd?.pendingQuestionId
        ? state.questions.find((q) => q.id === sd.pendingQuestionId)
        : null;
      return c.json({
        ended: state.ended,
        questionId: question?.id ?? null,
        question: question?.text ?? null,
        phase: sd?.phase ?? null,
        checkpoint: question?.checkpoint ?? false,
        speak: !(question?.checkpoint && sd?.problemSnapshot?.questionBank),
        deadlineAt: runtime.deadlineAt.toISOString(),
      });
    } catch {
      return c.json({ ended: true, questionId: null, question: null });
    }
  });
  return app;
}
