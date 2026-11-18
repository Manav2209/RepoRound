import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, prisma } from "@repo/db";
import { newId } from "../lib/ids.js";
import { activeSessions } from "../interview/active-sessions.js";
export const interviewTrace = new AsyncLocalStorage<{
  interviewId: string;
  step?: string;
  turnId?: string;
  questionId?: string;
  signal?: AbortSignal;
}>();
export function withTrace<T>(
  interviewId: string,
  step: string,
  operation: () => Promise<T>,
  correlation: {
    turnId?: string;
    questionId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const parent = interviewTrace.getStore();
  return interviewTrace.run(
    {
      ...(parent?.interviewId === interviewId ? parent : {}),
      interviewId,
      step,
      ...correlation,
    },
    () =>
      trace(interviewId, step, operation, {
        turnId: correlation.turnId,
        questionId: correlation.questionId,
      }),
  );
}

export function domainEvent(
  interviewId: string,
  type: string,
  payload: Record<string, unknown> = {},
) {
  return {
    id: newId("ie"),
    interviewId,
    type,
    payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
  };
}

export async function emit(
  interviewId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const context = interviewTrace.getStore();
  const correlation =
    context?.interviewId === interviewId
      ? { turnId: context.turnId, questionId: context.questionId }
      : {};
  const event = domainEvent(interviewId, type, { ...correlation, ...payload });
  if (!activeSessions.record(interviewId, event))
    await prisma.interviewEvent.create({ data: event });
}

export async function trace<T>(
  interviewId: string,
  name: string,
  operation: () => Promise<T>,
  metadata: Record<string, unknown> = {},
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    await emit(interviewId, name, {
      ...metadata,
      startedAt,
      durationMs: Date.now() - startedAt,
    }).catch(() => {});
    return result;
  } catch (err) {
    await emit(interviewId, name, {
      ...metadata,
      startedAt,
      durationMs: Date.now() - startedAt,
      failed: true,
    }).catch(() => {});
    throw err;
  }
}

const hash = (value: string, length: number) =>
  createHash("sha256").update(value).digest("hex").slice(0, length);
export function otlpSpan(event: {
  id: string;
  interviewId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}) {
  const data = event.payload as Record<string, unknown>;
  const start =
    typeof data.startedAt === "number" && Number.isFinite(data.startedAt)
      ? data.startedAt
      : event.createdAt.getTime();
  const duration =
    typeof data.durationMs === "number" && Number.isFinite(data.durationMs)
      ? Math.max(1, data.durationMs)
      : 1;
  const nanoseconds = (milliseconds: number) => {
    const whole = Math.trunc(milliseconds);
    return (
      BigInt(whole) * 1_000_000n +
      BigInt(Math.round((milliseconds - whole) * 1_000_000))
    );
  };
  const startNs = nanoseconds(start);
  const metadata = Object.fromEntries(
    Object.entries(data).filter(
      ([key]) =>
        !["text", "answer", "transcript", "content", "evidence"].includes(key),
    ),
  );
  return {
    traceId: hash(event.interviewId, 32),
    spanId: hash(event.id, 16),
    ...(event.type !== "interview.started"
      ? { parentSpanId: hash(`${event.interviewId}:root`, 16) }
      : { spanId: hash(`${event.interviewId}:root`, 16) }),
    name: event.type,
    kind: 1,
    startTimeUnixNano: String(startNs),
    endTimeUnixNano: String(startNs + nanoseconds(duration)),
    attributes: [
      {
        key: "langfuse.trace.name",
        value: { stringValue: "repository-interview" },
      },
      {
        key: "langfuse.trace.session_id",
        value: { stringValue: event.interviewId },
      },
      {
        key: "langfuse.observation.type",
        value: {
          stringValue: event.type.startsWith("llm.") ? "generation" : "span",
        },
      },
      {
        key: "langfuse.observation.metadata",
        value: { stringValue: JSON.stringify(metadata) },
      },
    ],
    status: { code: data.failed ? 2 : 1 },
  };
}

export async function exportTraces(): Promise<void> {
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } =
    process.env;
  if (!publicKey || !secretKey) return;
  const events = await prisma.interviewEvent.findMany({
    where: { exportedAt: null },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  if (!events.length) return;
  const base = (
    process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com"
  ).replace(/\/+$/, "");
  const res = await fetch(`${base}/api/public/otel/v1/traces`, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
      "content-type": "application/json",
      "x-langfuse-ingestion-version": "4",
    },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "ai-interview" } },
            ],
          },
          scopeSpans: [
            { scope: { name: "ai-interview" }, spans: events.map(otlpSpan) },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Langfuse OTLP export failed (${res.status})`);
  const body = (await res.json().catch(() => ({}))) as {
    partialSuccess?: { rejectedSpans?: number | string };
  };
  if (Number(body.partialSuccess?.rejectedSpans ?? 0) > 0)
    throw new Error("Langfuse rejected trace spans");
  await prisma.interviewEvent.updateMany({
    where: { id: { in: events.map((e) => e.id) } },
    data: { exportedAt: new Date() },
  });
}
