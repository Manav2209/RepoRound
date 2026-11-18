/// <reference types="bun" />
import { expect, test } from "bun:test";
import { BackendGateway } from "./gateway.js";
import type { VoiceMetric } from "../session/telemetry.js";

test("turn retries count each attempt without leaking authorization or transcript", async () => {
  const previous = globalThis.fetch;
  const metrics: VoiceMetric[] = [];
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    return attempts === 1
      ? Response.json({ error: "busy" }, { status: 503 })
      : Response.json({
          ended: false,
          questionId: "q2",
          question: "Explain the queue boundary.",
        });
  }) as unknown as typeof fetch;
  try {
    const gateway = new BackendGateway(
      "http://example.invalid",
      "secret-token",
      (metric) => metrics.push(metric),
    );
    const response = await gateway.processTurn(
      "interview",
      "session",
      "turn",
      "q1",
      "private candidate answer",
    );
    expect(response.questionId).toBe("q2");
    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toMatchObject({
      source: "backend_attempt",
      turnId: "turn",
      questionId: "q1",
      attempt: 1,
      requestCount: 1,
      failed: true,
    });
    expect(metrics[1]).toMatchObject({ attempt: 2, failed: false });
    expect(JSON.stringify(metrics)).not.toContain("secret-token");
    expect(JSON.stringify(metrics)).not.toContain("private candidate answer");
  } finally {
    globalThis.fetch = previous;
  }
});

test("metrics delivery does not recursively generate HTTP attempt telemetry", async () => {
  const previous = globalThis.fetch;
  const metrics: VoiceMetric[] = [];
  globalThis.fetch = (async () =>
    Response.json({ outcome: "created" })) as unknown as typeof fetch;
  try {
    const gateway = new BackendGateway(
      "http://example.invalid",
      "secret-token",
      (metric) => metrics.push(metric),
    );
    await gateway.postRealtimeEvent({
      eventId: "event",
      interviewId: "interview",
      sessionId: "session",
      type: "voice.metrics",
      timestamp: new Date().toISOString(),
      payload: { source: "backend_attempt", durationMs: 10 },
    });
    expect(metrics).toHaveLength(0);
  } finally {
    globalThis.fetch = previous;
  }
});

test("a rejected turn is a failed attempt and telemetry failures do not alter retry semantics", async () => {
  const previous = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    return Response.json({ error: "invalid" }, { status: 400 });
  }) as unknown as typeof fetch;
  try {
    const gateway = new BackendGateway(
      "http://example.invalid",
      "secret-token",
      () => {
        throw new Error("metric sink unavailable");
      },
    );
    await expect(
      gateway.processTurn("interview", "session", "turn", "q1", "answer"),
    ).rejects.toThrow("Backend request rejected (400)");
    expect(attempts).toBe(1);
  } finally {
    globalThis.fetch = previous;
  }
});

test("the gateway preserves explicit silence flags and rejects malformed ones", async () => {
  const previous = globalThis.fetch;
  let speak: unknown = false;
  globalThis.fetch = (async () =>
    Response.json({
      ended: false,
      questionId: "checkpoint",
      question: "Choose whether to revise your design.",
      checkpoint: true,
      speak,
    })) as unknown as typeof fetch;
  try {
    const gateway = new BackendGateway(
      "http://example.invalid",
      "secret-token",
    );
    expect(
      await gateway.processTurn("interview", "session", "turn", "q1", "answer"),
    ).toMatchObject({ checkpoint: true, speak: false });
    speak = "false";
    await expect(
      gateway.processTurn("interview", "session", "turn2", "q1", "answer"),
    ).rejects.toThrow("Invalid backend question response");
  } finally {
    globalThis.fetch = previous;
  }
});
