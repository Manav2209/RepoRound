import { expect, test } from "bun:test";
import {
  aggregateMetrics,
  latencyStats,
  metricPricingFromEnv,
  summarizeMetricEvents,
} from "./metrics.js";

test("startup excludes only its measured intentional wait; normal turns do not", () => {
  const summary = summarizeMetricEvents([
    {
      type: "voice.startup",
      payload: {
        durationMs: 12_100,
        intentionalDelayMs: 10_000,
        adjustedDurationMs: 0,
      },
    },
    {
      type: "voice.response_start",
      payload: { durationMs: 6_000, intentionalDelayMs: 10_000 },
    },
  ]);
  expect(summary.samples[0]?.adjustedDurationMs).toBe(2100);
  expect(summary.samples[1]?.adjustedDurationMs).toBeUndefined();
  const result = aggregateMetrics([
    { status: "completed", startedAt: new Date(), summary },
  ]);
  expect(result.latency["voice.startup_adjusted"]?.p50Ms).toBe(2100);
  expect(result.latency["voice.response_start"]?.p50Ms).toBe(6000);
});

test("failed/cancelled calls remain counted and are excluded from successful latency percentiles", () => {
  const summary = summarizeMetricEvents([
    {
      type: "llm.answer_analysis",
      payload: {
        durationMs: 100,
        tokenUsage: { prompt_tokens: 40, completion_tokens: 10 },
      },
    },
    {
      type: "llm.answer_analysis",
      payload: { durationMs: 4500, failed: true },
    },
    {
      type: "voice.response_cancelled",
      payload: { durationMs: 1500, cancelled: true },
    },
  ]);
  const result = aggregateMetrics([
    { status: "completed", startedAt: new Date(), summary },
  ]);
  expect(result.latency["llm.answer_analysis"]).toMatchObject({
    count: 1,
    observed: 2,
    failed: 1,
    p95Ms: 100,
  });
  expect(result.usage).toMatchObject({
    modelRequests: 2,
    failedModelRequests: 1,
    requestsWithReportedTokens: 1,
    inputTokens: 40,
    outputTokens: 10,
  });
  expect(result.cost.knownEstimatedUsd).toBeNull();
  expect(result.cost.complete).toBe(false);
});

test("streaming STT usage is not misrepresented as zero-millisecond transcription latency", () => {
  const summary = summarizeMetricEvents([
    {
      type: "voice.stt",
      payload: {
        durationMs: 0,
        audioSeconds: 8,
        measurementKind: "sdk_streaming_stt_usage_not_latency",
        requestCount: 1,
      },
    },
  ]);
  const result = aggregateMetrics([
    { status: "active", startedAt: new Date(), summary },
  ]);
  expect(result.latency["voice.stt"]?.count).toBe(0);
  expect(result.usage.sttAudioSeconds).toBe(8);
  expect(result.usage.sttRequests).toBe(1);
});

test("retained metrics exclude transcripts, prompts, secrets and raw error strings", () => {
  const summary = summarizeMetricEvents([
    {
      type: "voice.error",
      payload: {
        text: "private answer",
        error: "token-secret",
        detail: "private prompt",
        durationMs: 10,
        turnId: "t1",
      },
    },
  ]);
  expect(JSON.stringify(summary)).not.toMatch(
    /private answer|private prompt|token-secret/,
  );
  expect(summary.samples[0]?.turnId).toBe("t1");
  expect(summary.voiceErrorEvents).toBe(1);
});

test("percentiles are calculated over individual samples, and empty measurements remain unknown", () => {
  expect(latencyStats([])).toMatchObject({
    count: 0,
    p50Ms: null,
    p95Ms: null,
  });
  expect(latencyStats([1, 2, 3, 4, 100])).toMatchObject({
    count: 5,
    p50Ms: 3,
    p95Ms: 100,
  });
  const report = aggregateMetrics([
    { status: "active", startedAt: new Date(), summary: {} },
    { status: "completed", startedAt: new Date(), summary: {} },
  ]);
  expect(report.lifecycle.completionRate).toBe(0.5);
  expect(report.quality.sourceReferenceCoverage).toBeNull();
  expect(report.controls.recoverySuccessRate).toBeNull();
});

test("cost estimates use only explicitly supplied rates and mark missing billable data", () => {
  const summary = summarizeMetricEvents([
    {
      type: "llm.answer_analysis",
      payload: {
        durationMs: 50,
        tokenUsage: { prompt_tokens: 1000, completion_tokens: 200 },
      },
    },
  ]);
  const report = aggregateMetrics(
    [{ status: "completed", startedAt: new Date(), summary }],
    { llmInputUsdPerMillion: 1, llmOutputUsdPerMillion: 2 },
  );
  expect(report.cost.knownEstimatedUsd).toBeCloseTo(0.0014);
  expect(report.cost.complete).toBe(false);
  expect(() =>
    metricPricingFromEnv({ METRICS_LLM_INPUT_USD_PER_MILLION: "-1" }),
  ).toThrow();
});

test("repeat and presence controls count transitions, not repeated absent heartbeats or orderly close", () => {
  const event = (type: string, sessionId = "s1") => ({
    type,
    payload: { sessionId },
  });
  const summary = summarizeMetricEvents([
    event("voice.session.started"),
    event("voice.disconnect"),
    event("voice.session.disconnected"),
    event("voice.session.disconnected"),
    event("voice.reconnect"),
    event("voice.session.heartbeat"),
    event("interviewer.question_repeated"),
    event("voice.session.disconnected"),
  ]);
  const report = aggregateMetrics([
    { status: "completed", startedAt: new Date(), summary },
  ]);
  expect(report.controls).toMatchObject({
    repeatRequestsHandled: 1,
    disconnectEvents: 1,
    reconnectEvents: 1,
  });
});

test("legacy workers deduplicate disconnect heartbeats per session until observed reconnect", () => {
  const event = (type: string, sessionId = "s1") => ({
    type,
    payload: { sessionId },
  });
  const summary = summarizeMetricEvents([
    event("voice.session.started"),
    event("voice.session.disconnected"),
    event("voice.session.disconnected"),
    event("voice.session.disconnected", "s2"),
    event("voice.session.heartbeat"),
    event("voice.session.disconnected"),
  ]);
  expect(summary).toMatchObject({ disconnectEvents: 3, reconnectEvents: 1 });
});

test("an orderly modern shutdown without connection transitions is not a disconnect", () => {
  const event = (type: string, sessionId = "s1") => ({
    type,
    payload: { sessionId },
  });
  expect(
    summarizeMetricEvents([
      event("voice.session.started"),
      event("voice.session.disconnected"),
      event("voice.worker_closed"),
    ]).disconnectEvents,
  ).toBe(0);
  expect(
    summarizeMetricEvents([
      event("voice.session.started"),
      event("voice.worker_closed"),
      event("voice.session.started", "s2"),
    ]).workerClosureReceived,
  ).toBe(false);
});

test("TTS usage survives missing latency and cancelled synthesis; provider segments preserve request counts", () => {
  const summary = summarizeMetricEvents([
    {
      type: "voice.tts",
      payload: {
        firstAudioMs: 20,
        charactersCount: 100,
        audioSeconds: 2,
        requestCount: 1,
        requestId: "req1",
        speechId: "speech1",
        modelProvider: "test",
        streamed: true,
      },
    },
    {
      type: "voice.tts",
      payload: {
        durationMs: 80,
        firstAudioMs: 15,
        charactersCount: 50,
        audioSeconds: 1,
        requestCount: 0,
        requestId: "req1",
        cancelled: true,
      },
    },
    { type: "voice.tts", payload: { charactersCount: 10, audioSeconds: 0.2 } },
    {
      type: "voice.stt",
      payload: {
        audioSeconds: 4,
        requestCount: 1,
        measurementKind: "sdk_streaming_stt_usage_not_latency",
      },
    },
    {
      type: "voice.stt",
      payload: {
        audioSeconds: 2,
        requestCount: 0,
        measurementKind: "sdk_streaming_stt_usage_not_latency",
      },
    },
  ]);
  expect(summary.samples).toHaveLength(5);
  expect(summary.samples[0]).toMatchObject({
    requestId: "req1",
    speechId: "speech1",
    modelProvider: "test",
    streamed: true,
  });
  const report = aggregateMetrics([
    { status: "completed", startedAt: new Date(), summary },
  ]);
  expect(report.usage).toMatchObject({
    ttsCharacters: 160,
    ttsAudioSeconds: 3.2,
    ttsRequests: 1,
    ttsRequestCountComplete: false,
    sttRequests: 1,
    sttAudioSeconds: 6,
    sttRequestCountComplete: true,
  });
  expect(report.latency["voice.tts_first_audio"]).toMatchObject({
    count: 1,
    observed: 3,
    cancelled: 1,
    p50Ms: 20,
  });
});

test("cost completeness requires untruncated summaries and all reported billable voice fields", () => {
  const events = [
    {
      type: "llm.answer_analysis",
      payload: {
        durationMs: 50,
        tokenUsage: { prompt_tokens: 1000, completion_tokens: 200 },
      },
    },
    { type: "voice.stt", payload: { audioSeconds: 60 } },
    { type: "voice.tts", payload: { charactersCount: 1000 } },
    { type: "voice.worker_closed", payload: { durationMs: 0 } },
  ];
  const prices = {
    llmInputUsdPerMillion: 1,
    llmOutputUsdPerMillion: 2,
    sttUsdPerMinute: 0.01,
    ttsUsdPerMillionCharacters: 5,
  };
  const run = (summary: unknown) => ({
    status: "completed",
    startedAt: new Date(),
    summary,
  });
  const summary = summarizeMetricEvents(events);
  const report = aggregateMetrics([run(summary)], prices);
  expect(report.cost).toMatchObject({ complete: true });
  expect(report.coverage.roundsWithWorkerClosure).toBe(1);
  expect(report.cost.knownEstimatedUsd).toBeCloseTo(0.0164);
  expect(
    aggregateMetrics([run(summarizeMetricEvents(events, true))], prices).cost
      .complete,
  ).toBe(false);
  expect(
    aggregateMetrics([run(summary), run(null)], prices).cost.complete,
  ).toBe(false);
  const missingCharacters = summarizeMetricEvents([
    ...events,
    { type: "voice.tts", payload: { durationMs: 50 } },
  ]);
  expect(aggregateMetrics([run(missingCharacters)], prices).cost.complete).toBe(
    false,
  );
  expect(
    aggregateMetrics(
      [
        run(
          summarizeMetricEvents(
            events.filter((event) => event.type !== "voice.worker_closed"),
          ),
        ),
      ],
      prices,
    ).cost.complete,
  ).toBe(false);
  const secondSession = summarizeMetricEvents([
    ...events,
    { type: "voice.tts", payload: { sessionId: "s2", charactersCount: 1000 } },
  ]);
  expect(secondSession.workerClosureReceived).toBe(false);
});
