/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { AgentMetrics } from "@livekit/agents";
import { VoiceTelemetry, type VoiceMetric } from "./telemetry.js";

function fixture() {
  let now = 0;
  const metrics: VoiceMetric[] = [];
  const telemetry = new VoiceTelemetry(
    (metric) => metrics.push(metric),
    () => now,
  );
  return {
    telemetry,
    metrics,
    at: (time: number) => {
      now = time;
    },
  };
}

test("startup excludes the actual intentional wait, while normal turns never subtract it", () => {
  const { telemetry, metrics, at } = fixture();
  telemetry.beginStartup();
  telemetry.addIntentionalDelay(10_123);
  telemetry.expectOpening("q1");
  telemetry.speechCreated("opening", "say");
  at(11_500);
  telemetry.engineSpeaking("opening");
  telemetry.engineSpeaking("opening");
  expect(metrics).toHaveLength(1);
  expect(metrics[0]).toMatchObject({
    source: "startup",
    durationMs: 11_500,
    intentionalDelayMs: 10_123,
    adjustedDurationMs: 1_377,
  });
  at(12_000);
  telemetry.turnCommitted("turn1", "q1");
  telemetry.speechCreated("reply1", "generate_reply");
  telemetry.responseReady("turn1", "q2");
  at(14_900);
  telemetry.engineSpeaking("reply1");
  telemetry.engineSpeaking("reply1");
  expect(
    metrics.filter((metric) => metric.source === "response_start"),
  ).toEqual([
    expect.objectContaining({
      durationMs: 2_900,
      turnId: "turn1",
      questionId: "q2",
      measurementKind: "worker_committed_turn_to_engine_speaking_proxy",
    }),
  ]);
  expect(metrics[1]?.intentionalDelayMs).toBeUndefined();
});

test("worker stage metrics split node scheduling and post-backend audio rendering without double counting", () => {
  const { telemetry, metrics, at } = fixture();
  telemetry.turnCommitted("turn", "q1");
  at(100);
  telemetry.nodeEntered("turn");
  telemetry.speechCreated("speech", "generate_reply");
  at(2500);
  telemetry.responseReady("turn", "q2");
  at(2510);
  telemetry.textHandoff("turn");
  at(3000);
  telemetry.engineSpeaking("speech");
  expect(
    metrics.find((metric) => metric.source === "node_entry")?.durationMs,
  ).toBe(100);
  expect(
    metrics.find((metric) => metric.source === "text_handoff")?.durationMs,
  ).toBe(10);
  expect(
    metrics.find((metric) => metric.source === "response_render_start")
      ?.durationMs,
  ).toBe(500);
  expect(
    metrics.find((metric) => metric.source === "response_start")?.durationMs,
  ).toBe(3000);
});

test("cancelled and superseded turns cannot claim a later turn's speech", () => {
  const { telemetry, metrics, at } = fixture();
  telemetry.turnCommitted("old", "q1");
  telemetry.speechCreated("old-speech", "generate_reply");
  at(500);
  telemetry.cancelTurn("worker_user_resumed_speech");
  at(800);
  telemetry.turnCommitted("new", "q1");
  telemetry.speechCreated("new-speech", "generate_reply");
  telemetry.responseReady("old", "q2");
  telemetry.responseReady("new", "q3");
  telemetry.cancelTurn("worker_backend_response_failed", "old");
  at(2_000);
  telemetry.engineSpeaking("old-speech");
  telemetry.engineSpeaking("unrelated-poll-speech");
  expect(
    metrics.filter((metric) => metric.source === "response_start"),
  ).toHaveLength(0);
  telemetry.engineSpeaking("new-speech");
  expect(metrics.at(-1)).toMatchObject({
    source: "response_start",
    turnId: "new",
    durationMs: 1_200,
  });
  expect(metrics[0]).toMatchObject({
    source: "response_cancelled",
    turnId: "old",
    cancelled: true,
  });
});

test("speech cancellation and shutdown clear unfinished measurements", () => {
  const { telemetry, metrics, at } = fixture();
  telemetry.turnCommitted("turn", "q1");
  telemetry.speechCreated("speech", "generate_reply");
  at(500);
  telemetry.speechFinished("speech", true);
  telemetry.responseReady("turn", "q2");
  telemetry.engineSpeaking("speech");
  expect(metrics).toHaveLength(1);
  telemetry.beginStartup();
  at(800);
  telemetry.close();
  telemetry.close();
  expect(metrics[1]).toMatchObject({
    source: "startup",
    failed: true,
    durationMs: 300,
  });
});

test("streaming usage adds audio while counting the same provider request only once", () => {
  const { telemetry, metrics } = fixture();
  const usage: AgentMetrics = {
    type: "stt_metrics",
    requestId: "stream-1",
    timestamp: 1,
    label: "stt",
    durationMs: 0,
    audioDurationMs: 2_500,
    streamed: true,
  };
  telemetry.providerMetric(usage);
  telemetry.providerMetric(usage);
  telemetry.providerMetric({ ...usage, requestId: "" });
  expect(metrics[0]).toMatchObject({
    audioSeconds: 2.5,
    requestCount: 1,
    durationMs: 0,
    measurementKind: "sdk_streaming_stt_usage_not_latency",
  });
  expect(metrics[1]).toMatchObject({ audioSeconds: 2.5, requestCount: 0 });
  expect(metrics[2]?.requestCount).toBeUndefined();
});

test("TTS usage and EOU metrics retain speech correlation and SDK units", () => {
  const { telemetry, metrics } = fixture();
  telemetry.turnCommitted("turn", "q1");
  telemetry.speechCreated("speech", "generate_reply");
  telemetry.providerMetric({
    type: "eou_metrics",
    timestamp: 1,
    speechId: "speech",
    endOfUtteranceDelayMs: 600,
    transcriptionDelayMs: 120,
    onUserTurnCompletedDelayMs: 0,
    lastSpeakingTimeMs: 1,
  });
  telemetry.responseReady("turn", "q2");
  telemetry.providerMetric({
    type: "tts_metrics",
    timestamp: 1,
    label: "tts",
    requestId: "tts1",
    speechId: "speech",
    durationMs: 1_000,
    ttfbMs: 230,
    audioDurationMs: 3_200,
    charactersCount: 42,
    cancelled: false,
    streamed: true,
    metadata: { modelProvider: "provider", modelName: "model" },
  });
  expect(metrics[0]).toMatchObject({
    source: "end_of_utterance",
    turnId: "turn",
    questionId: "q1",
    durationMs: 600,
    transcriptionDelayMs: 120,
  });
  expect(metrics[1]).toMatchObject({
    source: "tts",
    turnId: "turn",
    questionId: "q2",
    firstAudioMs: 230,
    audioSeconds: 3.2,
    charactersCount: 42,
    requestCount: 1,
    modelProvider: "provider",
  });
});

test("missing first audio is not reported as zero latency", () => {
  const { telemetry, metrics } = fixture();
  telemetry.providerMetric({
    type: "tts_metrics",
    timestamp: 1,
    label: "tts",
    requestId: "tts1",
    durationMs: 100,
    ttfbMs: -1,
    audioDurationMs: 0,
    charactersCount: 0,
    cancelled: true,
    streamed: true,
  });
  expect(metrics[0]?.firstAudioMs).toBeUndefined();
  expect(metrics[0]?.cancelled).toBe(true);
});

test("UI-only checkpoints and resumed UI pauses never become audio latency samples", () => {
  const { telemetry, metrics, at } = fixture();
  telemetry.beginStartup();
  telemetry.skipStartup();
  telemetry.turnCommitted("turn", "q1");
  telemetry.speechCreated("silent", "generate_reply");
  at(500);
  telemetry.cancelTurn("worker_ui_only_checkpoint", "turn");
  telemetry.engineSpeaking("silent");
  telemetry.close();
  expect(metrics).toHaveLength(1);
  expect(metrics[0]).toMatchObject({
    source: "response_cancelled",
    failed: false,
    measurementKind: "worker_ui_only_checkpoint",
  });
});
