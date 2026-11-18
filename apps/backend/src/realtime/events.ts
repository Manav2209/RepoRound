import { Prisma, prisma } from "@repo/db";
import { z } from "zod";
import type { RealtimeEventInput } from "../db/repositories/realtime-event.repo.js";
import { domainEvent } from "../observability/events.js";
import { withInterviewLock } from "../interview/runtime-lock.js";
import { stateSchema } from "../interview/schemas.js";
import { activeSessions } from "../interview/active-sessions.js";

export const realtimeEventSchema = z
  .object({
    eventId: z.string().min(1).max(100),
    interviewId: z.string().min(1).max(100),
    sessionId: z.string().min(1).max(100),
    type: z.enum([
      "session.started",
      "session.disconnected",
      "session.failed",
      "session.heartbeat",
      "transcript.completed",
      "speech.interrupted",
      "voice.metrics",
      "error",
    ]),
    timestamp: z.string().datetime(),
    payload: z
      .object({
        role: z.literal("assistant").optional(),
        text: z.string().max(1000).optional(),
        turnId: z.string().max(100).optional(),
        questionId: z.string().max(100).optional(),
        turnIndex: z.number().int().nonnegative().optional(),
        interrupted: z.boolean().optional(),
        completedAt: z.string().datetime().optional(),
        error: z.string().max(1000).optional(),
        detail: z.string().max(2000).optional(),
        source: z.string().max(100).optional(),
        durationMs: z.number().finite().nonnegative().optional(),
        firstAudioMs: z.number().finite().nonnegative().optional(),
        intentionalDelayMs: z.number().finite().nonnegative().optional(),
        adjustedDurationMs: z.number().finite().nonnegative().optional(),
        audioSeconds: z.number().finite().nonnegative().optional(),
        charactersCount: z.number().finite().nonnegative().optional(),
        requestCount: z.number().int().nonnegative().optional(),
        failed: z.boolean().optional(),
        cancelled: z.boolean().optional(),
        streamed: z.boolean().optional(),
        attempt: z.number().int().positive().optional(),
        measurementKind: z.string().max(100).optional(),
        speechId: z.string().max(100).optional(),
        requestId: z.string().max(200).optional(),
        transcriptionDelayMs: z.number().finite().nonnegative().optional(),
        modelProvider: z.string().max(100).optional(),
        modelName: z.string().max(200).optional(),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
      })
      .default({}),
  })
  .superRefine((event, ctx) => {
    if (event.type === "voice.metrics" && !event.payload.source)
      ctx.addIssue({ code: "custom", message: "Voice metric source required" });
    if (
      event.type === "transcript.completed" &&
      (!event.payload.turnId ||
        !event.payload.text ||
        event.payload.role !== "assistant")
    )
      ctx.addIssue({
        code: "custom",
        message: "Assistant transcript fields required",
      });
  });

export type ProcessResult = {
  outcome: "created" | "duplicate";
  turnCreated?: boolean;
};
export async function requireSession(
  interviewId: string,
  sessionId: string,
): Promise<void> {
  if (activeSessions.peek(interviewId)) {
    activeSessions.require(interviewId, sessionId);
    return;
  }
  if (
    !(await prisma.interviewSession.findFirst({
      where: { id: sessionId, interviewId },
    }))
  )
    throw new Error("Invalid interview session");
}

export class RealtimeEventService {
  async process(input: RealtimeEventInput): Promise<ProcessResult> {
    const event = realtimeEventSchema.parse(input);
    const memory = activeSessions.peek(event.interviewId);
    if (memory && !memory.persisted) {
      activeSessions.require(event.interviewId, event.sessionId);
      if (memory.eventIds.has(event.eventId)) return { outcome: "duplicate" };
      let turnCreated = false;
      if (event.type === "transcript.completed") {
        const question = memory.state.questions.find(
          (item) => item.id === event.payload.questionId,
        );
        if (!question && !memory.state.ended && !event.payload.interrupted)
          throw new Error("Unknown spoken question");
        const prior = memory.turns.find(
          (item) => item.id === event.payload.turnId,
        );
        if (
          prior &&
          (prior.text !== event.payload.text ||
            prior.sessionId !== event.sessionId)
        )
          throw new Error("Transcript ID conflicts with existing turn");
        if (!prior && question) {
          activeSessions.addTurn(event.interviewId, {
            id: event.payload.turnId!,
            interviewId: event.interviewId,
            sessionId: event.sessionId,
            questionId: question.id,
            role: "assistant",
            text: event.payload.text!,
            turnIndex: memory.turns.length,
            createdAt: new Date(),
            completedAt: new Date(event.payload.completedAt ?? event.timestamp),
            analysisStatus: "skipped",
          });
          turnCreated = true;
        }
        if (
          question &&
          !event.payload.interrupted &&
          event.payload.text?.trim() === question.text.trim()
        )
          question.spokenAt = event.timestamp;
      }
      if (
        (event.type === "voice.metrics" &&
          event.payload.source === "disconnect") ||
        event.type === "session.failed" ||
        event.type === "session.disconnected"
      ) {
        memory.connected = false;
        memory.disconnectedAt ??= new Date();
        if (memory.current)
          activeSessions.cancel(event.interviewId, memory.current.id);
      }
      activeSessions.record(event.interviewId, {
        ...domainEvent(
          event.interviewId,
          event.type === "voice.metrics"
            ? `voice.${event.payload.source}`
            : `voice.${event.type}`,
          {
            sessionId: event.sessionId,
            ...Object.fromEntries(
              Object.entries(event.payload).filter(
                ([key]) => !["text", "error", "detail", "role"].includes(key),
              ),
            ),
          },
        ),
        id: event.eventId,
      });
      return { outcome: "created", turnCreated };
    }
    await requireSession(event.interviewId, event.sessionId);
    if (
      await prisma.realtimeEvent.findUnique({
        where: { eventId: event.eventId },
      })
    )
      return { outcome: "duplicate" };
    const persist = async (token?: string): Promise<ProcessResult> =>
      prisma.$transaction(async (tx) => {
        if (
          await tx.realtimeEvent.findUnique({
            where: { eventId: event.eventId },
          })
        )
          return { outcome: "duplicate" };
        let turnCreated = false;
        if (event.type === "transcript.completed") {
          const runtime = await tx.interviewRuntime.findUniqueOrThrow({
            where: { interviewId: event.interviewId },
          });
          const state = stateSchema.parse(runtime.data);
          const question = state.questions.find(
            (q) => q.id === event.payload.questionId,
          );
          if (!question && (!state.ended || event.payload.questionId))
            throw new Error("Unknown spoken question");
          const prior = await tx.conversationTurn.findUnique({
            where: { id: event.payload.turnId! },
          });
          if (
            prior &&
            (prior.interviewId !== event.interviewId ||
              prior.sessionId !== event.sessionId ||
              prior.text !== event.payload.text)
          )
            throw new Error("Transcript ID conflicts with existing turn");
          if (!prior) {
            await tx.conversationTurn.create({
              data: {
                id: event.payload.turnId!,
                interviewId: event.interviewId,
                sessionId: event.sessionId,
                questionId: question?.id,
                role: "assistant",
                text: event.payload.text!,
                turnIndex: await tx.conversationTurn.count({
                  where: { interviewId: event.interviewId },
                }),
                analysisStatus: "skipped",
                completedAt: new Date(
                  event.payload.completedAt ?? event.timestamp,
                ),
              },
            });
            turnCreated = true;
          }
          if (
            question &&
            !event.payload.interrupted &&
            event.payload.text?.trim() === question.text.trim()
          )
            question.spokenAt = new Date().toISOString();
          const saved = await tx.interviewRuntime.updateMany({
            where: {
              interviewId: event.interviewId,
              version: runtime.version,
              leaseToken: token,
            },
            data: {
              version: { increment: 1 },
              data: state as unknown as Prisma.InputJsonValue,
            },
          });
          if (!saved.count)
            throw new Error("State changed during transcript persistence");
        }
        const session = await tx.interviewSession.findUniqueOrThrow({
          where: { id: event.sessionId },
        });
        if (["created", "active"].includes(session.status)) {
          if (["session.started", "session.heartbeat"].includes(event.type))
            await tx.interviewSession.update({
              where: { id: session.id },
              data: {
                status: "active",
                startedAt: session.startedAt ?? new Date(),
                heartbeatAt: new Date(),
                disconnectedAt: null,
              },
            });
          if (["session.disconnected", "session.failed"].includes(event.type))
            await tx.interviewSession.update({
              where: { id: session.id },
              data: {
                status: "created",
                disconnectedAt: session.disconnectedAt ?? new Date(),
              },
            });
        }
        await tx.realtimeEvent.create({
          data: {
            ...event,
            timestamp: new Date(event.timestamp),
            payload: event.payload as Prisma.InputJsonValue,
          },
        });
        await tx.interviewEvent.create({
          data: domainEvent(
            event.interviewId,
            event.type === "voice.metrics"
              ? `voice.${event.payload.source}`
              : `voice.${event.type}`,
            {
              sessionId: event.sessionId,
              // Keep telemetry fields/correlation, never transcript/error text.
              ...Object.fromEntries(
                Object.entries(event.payload).filter(
                  ([key]) => !["text", "error", "detail", "role"].includes(key),
                ),
              ),
            },
          ),
        });
        return { outcome: "created", turnCreated };
      });
    return event.type === "transcript.completed"
      ? withInterviewLock(event.interviewId, persist)
      : persist();
  }
}
