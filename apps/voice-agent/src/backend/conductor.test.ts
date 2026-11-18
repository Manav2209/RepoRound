/// <reference types="bun" />
import { expect, test } from "bun:test";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InterviewConductor } from "./conductor.js";
import type { BackendGateway, RealtimeEventInput } from "./gateway.js";

test("the durable voice journal forwards complete metric fields and counts reconnect transitions once", async () => {
  const previous = process.env.VOICE_OUTBOX_DIR;
  const directory = await mkdtemp(join(tmpdir(), "rr-voice-metrics-"));
  process.env.VOICE_OUTBOX_DIR = directory;
  const events: RealtimeEventInput[] = [];
  const logger = { info: () => {}, warn: () => {} };
  const gateway = {
    postRealtimeEvent: async (event: RealtimeEventInput) => {
      events.push(structuredClone(event));
      return { outcome: "created" };
    },
  } as unknown as BackendGateway;
  const conductor = new InterviewConductor(
    gateway,
    "metrics-test",
    "server-session",
    logger,
  );
  try {
    conductor.onSessionEvent({
      type: "voice.metrics",
      sessionId: "sdk-session",
      source: "startup",
      durationMs: 12_000,
      intentionalDelayMs: 10_100,
      adjustedDurationMs: 1_900,
      measurementKind: "worker_entry_to_engine_speaking_proxy",
      questionId: "q1",
      speechId: "speech1",
    });
    conductor.heartbeat(true);
    conductor.heartbeat(false);
    conductor.heartbeat(false);
    conductor.heartbeat(true);
    expect(await conductor.flush({ stop: false })).toBe(true);
    conductor.recordMetric({ source: "worker_closed", durationMs: 0 });
    expect(await conductor.flush()).toBe(true);
    const recorded = events.filter((event) => event.type === "voice.metrics");
    expect(recorded[0]).toMatchObject({
      sessionId: "server-session",
      payload: {
        source: "startup",
        intentionalDelayMs: 10_100,
        adjustedDurationMs: 1_900,
        speechId: "speech1",
      },
    });
    expect(
      recorded.filter((event) => event.payload.source === "disconnect"),
    ).toHaveLength(1);
    expect(
      recorded.filter((event) => event.payload.source === "reconnect"),
    ).toHaveLength(1);
    expect(recorded[0]?.payload).not.toHaveProperty("sessionId");
    expect(recorded[0]?.payload).not.toHaveProperty("type");
    expect(events.at(-1)?.payload.source).toBe("worker_closed");
  } finally {
    if (previous === undefined) delete process.env.VOICE_OUTBOX_DIR;
    else process.env.VOICE_OUTBOX_DIR = previous;
    await unlink(join(directory, "metrics-test-server-session.json"));
    await rmdir(directory);
  }
});

test("flush timeout reports an incomplete drain and retains unacknowledged telemetry", async () => {
  const previous = process.env.VOICE_OUTBOX_DIR;
  const directory = await mkdtemp(join(tmpdir(), "rr-voice-drain-"));
  process.env.VOICE_OUTBOX_DIR = directory;
  let release: (() => void) | undefined;
  const acknowledgement = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gateway = {
    postRealtimeEvent: async () => {
      await acknowledgement;
      return { outcome: "created" };
    },
  } as unknown as BackendGateway;
  const conductor = new InterviewConductor(gateway, "timeout-test", "s1", {
    info: () => {},
    warn: () => {},
  });
  try {
    conductor.recordMetric({
      source: "tts",
      durationMs: 10,
      charactersCount: 5,
    });
    expect(await conductor.flush({ stop: false, timeoutMs: 0 })).toBe(false);
  } finally {
    release?.();
    await conductor.flush();
    if (previous === undefined) delete process.env.VOICE_OUTBOX_DIR;
    else process.env.VOICE_OUTBOX_DIR = previous;
    await unlink(join(directory, "timeout-test-s1.json"));
    await rmdir(directory);
  }
});
