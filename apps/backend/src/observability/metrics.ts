import { Prisma, prisma } from "@repo/db";
import { RepositoryKnowledge } from "../github/knowledge.js";
import { stateSchema } from "../interview/schemas.js";
import { activeSessions } from "../interview/active-sessions.js";
import {
  InterviewBusyError,
  withInterviewLock,
} from "../interview/runtime-lock.js";

export interface MetricSample {
  metric: string;
  durationMs?: number;
  failed: boolean;
  cancelled: boolean;
  turnId?: string;
  questionId?: string;
  speechId?: string;
  requestId?: string;
  model?: string;
  modelProvider?: string;
  streamed?: boolean;
  transcriptionDelayMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  audioSeconds?: number;
  charactersCount?: number;
  requestCount?: number;
  attempt?: number;
  intentionalDelayMs?: number;
  adjustedDurationMs?: number;
  firstAudioMs?: number;
  measurementKind?: string;
}

export interface MetricSummary {
  schemaVersion: 1;
  samples: MetricSample[];
  repeatRequestsHandled: number;
  disconnectEvents: number;
  reconnectEvents?: number;
  workerClosureReceived?: boolean;
  voiceErrorEvents: number;
  sourceReferences?: {
    eligibleQuestions: number;
    questionsWithValidReferences: number;
  };
  coverage: { eventsRead: number; truncated: boolean };
}

const numeric = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
const identifier = (value: unknown, limit = 100): string | undefined =>
  typeof value === "string" ? value.slice(0, limit) : undefined;

/** Retain operational numbers and bounded correlation IDs, never candidate text. */
export function summarizeMetricEvents(
  events: Array<{ type: string; payload: unknown }>,
  truncated = false,
): MetricSummary {
  const summary: MetricSummary = {
    schemaVersion: 1,
    samples: [],
    repeatRequestsHandled: 0,
    disconnectEvents: 0,
    reconnectEvents: 0,
    workerClosureReceived: false,
    voiceErrorEvents: 0,
    coverage: { eventsRead: events.length, truncated },
  };
  const objectPayload = (payload: unknown): Record<string, unknown> =>
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const sessionKey = (payload: Record<string, unknown>) =>
    identifier(payload.sessionId) ?? "unknown";
  const closedSessions = new Set(
    events
      .filter((event) => event.type === "voice.worker_closed")
      .map((event) => sessionKey(objectPayload(event.payload))),
  );
  const usageSessions = new Set(
    events
      .filter(
        (event) =>
          event.type === "voice.stt" ||
          event.type === "voice.tts" ||
          event.type === "voice.session.started",
      )
      .map((event) => sessionKey(objectPayload(event.payload))),
  );
  summary.workerClosureReceived =
    closedSessions.size > 0 &&
    [...usageSessions].every((sessionId) => closedSessions.has(sessionId));
  // Modern workers emit one transition metric, whereas session.disconnected is
  // also emitted on every absent-participant heartbeat and on orderly close.
  const transitionSessions = new Set(
    events
      .filter(
        (event) =>
          event.type === "voice.disconnect" || event.type === "voice.reconnect",
      )
      .map((event) => sessionKey(objectPayload(event.payload))),
  );
  const legacyConnected = new Map<string, boolean>();
  for (const event of events) {
    const payload = objectPayload(event.payload);
    const key = sessionKey(payload);
    if (event.type === "interviewer.question_repeated")
      summary.repeatRequestsHandled++;
    if (event.type === "voice.disconnect") summary.disconnectEvents++;
    if (event.type === "voice.reconnect") summary.reconnectEvents!++;
    if (!transitionSessions.has(key) && !closedSessions.has(key)) {
      if (
        event.type === "voice.session.started" ||
        event.type === "voice.session.heartbeat"
      ) {
        if (legacyConnected.get(key) === false) summary.reconnectEvents!++;
        legacyConnected.set(key, true);
      } else if (event.type === "voice.session.disconnected") {
        if (legacyConnected.get(key) !== false) summary.disconnectEvents++;
        legacyConnected.set(key, false);
      }
    }
    if (event.type === "voice.error" || event.type === "voice.session.failed")
      summary.voiceErrorEvents++;
    const durationMs =
      event.type === "voice.stt" &&
      payload.measurementKind === "sdk_streaming_stt_usage_not_latency"
        ? undefined
        : numeric(payload.durationMs);
    const hasUsage = [
      payload.audioSeconds,
      payload.charactersCount,
      payload.requestCount,
      payload.inputTokens,
      payload.outputTokens,
      payload.firstAudioMs,
    ].some((value) => numeric(value) !== undefined);
    if (
      durationMs === undefined &&
      !event.type.startsWith("llm.") &&
      event.type !== "voice.error" &&
      event.type !== "voice.session.failed" &&
      !hasUsage
    )
      continue;
    const usage =
      payload.tokenUsage && typeof payload.tokenUsage === "object"
        ? (payload.tokenUsage as Record<string, unknown>)
        : {};
    const details =
      usage.prompt_tokens_details &&
      typeof usage.prompt_tokens_details === "object"
        ? (usage.prompt_tokens_details as Record<string, unknown>)
        : {};
    summary.samples.push({
      metric: event.type,
      durationMs,
      failed:
        payload.failed === true ||
        event.type === "voice.error" ||
        event.type === "voice.session.failed",
      cancelled: payload.cancelled === true,
      turnId: identifier(payload.turnId),
      questionId: identifier(payload.questionId),
      speechId: identifier(payload.speechId),
      requestId: identifier(payload.requestId, 200),
      model: identifier(payload.model ?? payload.modelName, 200),
      modelProvider: identifier(payload.modelProvider),
      streamed:
        typeof payload.streamed === "boolean" ? payload.streamed : undefined,
      transcriptionDelayMs: numeric(payload.transcriptionDelayMs),
      inputTokens: numeric(usage.prompt_tokens ?? payload.inputTokens),
      outputTokens: numeric(usage.completion_tokens ?? payload.outputTokens),
      cachedInputTokens: numeric(details.cached_tokens),
      audioSeconds: numeric(payload.audioSeconds),
      charactersCount: numeric(payload.charactersCount),
      requestCount: numeric(payload.requestCount),
      attempt: numeric(payload.attempt),
      intentionalDelayMs: numeric(payload.intentionalDelayMs),
      // Only startup gets an intentional-delay adjustment. Never subtract ten
      // seconds from a normal conversation turn or provider call.
      adjustedDurationMs:
        event.type === "voice.startup" &&
        durationMs !== undefined &&
        numeric(payload.intentionalDelayMs) !== undefined
          ? Math.max(0, durationMs - (payload.intentionalDelayMs as number))
          : undefined,
      firstAudioMs: numeric(payload.firstAudioMs),
      measurementKind: identifier(payload.measurementKind),
    });
  }
  return summary;
}

export function latencyStats(values: number[]) {
  const sorted = values
    .filter((value) => numeric(value) !== undefined)
    .sort((a, b) => a - b);
  if (!sorted.length)
    return { count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const percentile = (p: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
  return {
    count: sorted.length,
    meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1)!,
  };
}

export interface MetricPricing {
  llmInputUsdPerMillion?: number;
  llmOutputUsdPerMillion?: number;
  sttUsdPerMinute?: number;
  ttsUsdPerMillionCharacters?: number;
}

export function metricPricingFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MetricPricing {
  const price = (key: string) => {
    const raw = env[key];
    if (raw === undefined || !raw.trim()) return undefined;
    const value = numeric(Number(raw));
    if (value === undefined)
      throw new Error(`${key} must be a nonnegative number`);
    return value;
  };
  return {
    llmInputUsdPerMillion: price("METRICS_LLM_INPUT_USD_PER_MILLION"),
    llmOutputUsdPerMillion: price("METRICS_LLM_OUTPUT_USD_PER_MILLION"),
    sttUsdPerMinute: price("METRICS_STT_USD_PER_MINUTE"),
    ttsUsdPerMillionCharacters: price("METRICS_TTS_USD_PER_MILLION_CHARACTERS"),
  };
}

export function aggregateMetrics(
  runs: Array<{ status: string; startedAt: Date | null; summary: unknown }>,
  pricing: MetricPricing = {},
) {
  const samples: MetricSample[] = [];
  let repeatRequestsHandled = 0,
    disconnectEvents = 0,
    reconnectEvents = 0,
    voiceErrorEvents = 0,
    referenceQuestions = 0,
    referencedQuestions = 0,
    archivedRuns = 0;
  for (const run of runs) {
    const summary = run.summary as Partial<MetricSummary> | null;
    if (summary?.schemaVersion !== 1 || !Array.isArray(summary.samples))
      continue;
    archivedRuns++;
    samples.push(...summary.samples);
    repeatRequestsHandled += summary.repeatRequestsHandled ?? 0;
    disconnectEvents += summary.disconnectEvents ?? 0;
    reconnectEvents += summary.reconnectEvents ?? 0;
    voiceErrorEvents += summary.voiceErrorEvents ?? 0;
    referenceQuestions += summary.sourceReferences?.eligibleQuestions ?? 0;
    referencedQuestions +=
      summary.sourceReferences?.questionsWithValidReferences ?? 0;
  }
  const byMetric: Record<
    string,
    { values: number[]; failures: number; cancelled: number; observed: number }
  > = {};
  for (const sample of samples) {
    const row = (byMetric[sample.metric] ??= {
      values: [],
      failures: 0,
      cancelled: 0,
      observed: 0,
    });
    row.observed++;
    row.failures += Number(sample.failed);
    row.cancelled += Number(sample.cancelled);
    if (!sample.failed && !sample.cancelled && sample.durationMs !== undefined)
      row.values.push(sample.durationMs);
    if (
      sample.metric === "voice.startup" &&
      !sample.failed &&
      !sample.cancelled &&
      sample.adjustedDurationMs !== undefined
    )
      (byMetric["voice.startup_adjusted"] ??= {
        values: [],
        failures: 0,
        cancelled: 0,
        observed: 0,
      }).values.push(sample.adjustedDurationMs);
    if (sample.metric === "voice.tts") {
      const firstAudio = (byMetric["voice.tts_first_audio"] ??= {
        values: [],
        failures: 0,
        cancelled: 0,
        observed: 0,
      });
      firstAudio.observed++;
      firstAudio.failures += Number(sample.failed);
      firstAudio.cancelled += Number(sample.cancelled);
      if (
        !sample.failed &&
        !sample.cancelled &&
        sample.firstAudioMs !== undefined
      )
        firstAudio.values.push(sample.firstAudioMs);
    }
  }
  const modelSamples = samples.filter((sample) =>
    sample.metric.startsWith("llm."),
  );
  const inputTokens = modelSamples.reduce(
    (n, s) => n + (s.inputTokens ?? 0),
    0,
  );
  const outputTokens = modelSamples.reduce(
    (n, s) => n + (s.outputTokens ?? 0),
    0,
  );
  const sttSamples = samples.filter((s) => s.metric === "voice.stt");
  const ttsSamples = samples.filter((s) => s.metric === "voice.tts");
  const sttAudioSeconds = sttSamples.reduce(
    (n, s) => n + (s.audioSeconds ?? 0),
    0,
  );
  const ttsAudioSeconds = ttsSamples.reduce(
    (n, s) => n + (s.audioSeconds ?? 0),
    0,
  );
  const ttsCharacters = ttsSamples.reduce(
    (n, s) => n + (s.charactersCount ?? 0),
    0,
  );
  const prices = [
    pricing.llmInputUsdPerMillion,
    pricing.llmOutputUsdPerMillion,
    pricing.sttUsdPerMinute,
    pricing.ttsUsdPerMillionCharacters,
  ];
  const allPricesKnown = prices.every((value) => numeric(value) !== undefined);
  const tokenUsageComplete = modelSamples.every(
    (s) =>
      !s.failed && s.inputTokens !== undefined && s.outputTokens !== undefined,
  );
  const hasVoiceUsage = sttSamples.length > 0 && ttsSamples.length > 0;
  const voiceUsageComplete =
    sttSamples.every((s) => s.audioSeconds !== undefined) &&
    ttsSamples.every((s) => s.charactersCount !== undefined);
  const summariesComplete =
    archivedRuns === runs.length &&
    runs.every((run) => {
      const summary = run.summary as Partial<MetricSummary> | null;
      const hasVoice = summary?.samples?.some(
        (sample) =>
          sample.metric === "voice.stt" || sample.metric === "voice.tts",
      );
      return (
        summary?.coverage?.truncated === false &&
        (!hasVoice || summary.workerClosureReceived === true)
      );
    });
  const knownEstimatedUsd =
    (inputTokens * (pricing.llmInputUsdPerMillion ?? 0) +
      outputTokens * (pricing.llmOutputUsdPerMillion ?? 0) +
      ttsCharacters * (pricing.ttsUsdPerMillionCharacters ?? 0)) /
      1_000_000 +
    (sttAudioSeconds / 60) * (pricing.sttUsdPerMinute ?? 0);
  const started = runs.filter((run) => run.startedAt !== null).length;
  const completed = runs.filter(
    (run) => run.startedAt !== null && run.status === "completed",
  ).length;
  return {
    lifecycle: {
      recordedRounds: runs.length,
      startedRounds: started,
      completedRounds: completed,
      completionRate: started ? completed / started : null,
      denominator:
        "recorded rounds with an allocated voice session; unfinished rounds remain in the denominator",
    },
    latency: Object.fromEntries(
      Object.entries(byMetric).map(([name, row]) => [
        name,
        {
          ...latencyStats(row.values),
          observed: row.observed || row.values.length,
          failed: row.failures,
          cancelled: row.cancelled,
        },
      ]),
    ),
    usage: {
      modelRequests: modelSamples.length,
      failedModelRequests: modelSamples.filter((s) => s.failed).length,
      requestsWithReportedTokens: modelSamples.filter(
        (s) => s.inputTokens !== undefined && s.outputTokens !== undefined,
      ).length,
      inputTokens,
      outputTokens,
      cachedInputTokens: modelSamples.reduce(
        (n, s) => n + (s.cachedInputTokens ?? 0),
        0,
      ),
      sttAudioSeconds,
      ttsAudioSeconds,
      ttsCharacters,
      sttRequests: sttSamples.reduce((n, s) => n + (s.requestCount ?? 0), 0),
      ttsRequests: ttsSamples.reduce((n, s) => n + (s.requestCount ?? 0), 0),
      sttRequestCountComplete:
        sttSamples.length > 0 &&
        sttSamples.every((s) => s.requestCount !== undefined),
      ttsRequestCountComplete:
        ttsSamples.length > 0 &&
        ttsSamples.every((s) => s.requestCount !== undefined),
    },
    cost: {
      knownEstimatedUsd: prices.some((value) => numeric(value) !== undefined)
        ? knownEstimatedUsd
        : null,
      complete:
        allPricesKnown &&
        tokenUsageComplete &&
        hasVoiceUsage &&
        voiceUsageComplete &&
        summariesComplete,
      estimateOnly: true,
      note: "Requires configured provider rates and complete billable usage. Not an invoice; cached-token pricing, failed requests and provider-specific billing may differ.",
    },
    quality: {
      sourceReferenceCoverage: referenceQuestions
        ? referencedQuestions / referenceQuestions
        : null,
      eligibleRepositoryQuestions: referenceQuestions,
      questionsWithValidReferences: referencedQuestions,
      note: "Valid pinned source references are a coverage proxy, not human-rated relevance or factual correctness.",
    },
    controls: {
      repeatRequestsHandled,
      disconnectEvents,
      reconnectEvents,
      voiceErrorEvents,
      retriesObserved: samples.filter(
        (s) => s.metric === "voice.backend_attempt" && (s.attempt ?? 1) > 1,
      ).length,
      recoverySuccessRate: null,
      note: "Reconnects are observed presence transitions, not proven state recovery. Recovery success requires a controlled test denominator; disconnect counts alone do not establish it.",
    },
    coverage: {
      roundsWithSummaries: archivedRuns,
      roundsWithoutSummaries: runs.length - archivedRuns,
      samples: samples.length,
      truncatedRounds: runs.filter(
        (run) =>
          (run.summary as Partial<MetricSummary> | null)?.coverage?.truncated,
      ).length,
      roundsWithWorkerClosure: runs.filter(
        (run) =>
          (run.summary as Partial<MetricSummary> | null)
            ?.workerClosureReceived === true,
      ).length,
      firstAudioMeasurement:
        "voice.response_start is a worker engine-speaking proxy, not browser-audible latency",
    },
  };
}

export async function snapshotInterviewMetrics(
  interviewId: string,
): Promise<MetricSummary | null> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { runtime: true },
  });
  if (!interview) return null;
  const events = await prisma.interviewEvent.findMany({
    where: { interviewId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 10_001,
    select: { type: true, payload: true },
  });
  const memory = activeSessions.peek(interviewId);
  const combined =
    memory && !memory.persisted ? [...events, ...memory.events] : events;
  const summary = summarizeMetricEvents(
    combined.slice(0, 10_000),
    combined.length > 10_000 || (memory?.droppedEvents ?? 0) > 0,
  );
  if (interview.runtime) {
    const state = stateSchema.safeParse(
      memory && !memory.persisted ? memory.state : interview.runtime.data,
    );
    if (state.success && interview.mode === "GITHUB") {
      const knowledge =
        memory?.knowledge ?? (await RepositoryKnowledge.load(interviewId));
      const eligible = state.data.questions.filter(
        (question) =>
          question.kind === "OPENING" || question.kind === "REPOSITORY",
      );
      summary.sourceReferences = {
        eligibleQuestions: eligible.length,
        questionsWithValidReferences: eligible.filter((question) =>
          question.repositoryReferences?.some((reference) =>
            knowledge.validReference(reference),
          ),
        ).length,
      };
    }
  }
  const finalState = stateSchema.safeParse(
    memory && !memory.persisted ? memory.state : interview.runtime?.data,
  );
  const data = {
    status:
      interview.status === "completed" &&
      finalState.success &&
      finalState.data.endReason === "disconnected"
        ? "abandoned"
        : interview.status,
    startedAt: interview.startedAt,
    completedAt: interview.completedAt,
    summary: summary as unknown as Prisma.InputJsonValue,
  };
  await prisma.interviewMetrics.upsert({
    where: { interviewId },
    create: {
      interviewId,
      userId: interview.userId,
      mode: interview.mode,
      problemId: interview.systemDesignProblemId,
      createdAt: interview.createdAt,
      ...data,
    },
    update: data,
  });
  return summary;
}

export async function readUserMetrics(
  userId: string,
  pricing: MetricPricing = {},
) {
  const active = await prisma.interview.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, runtime: { select: { interviewId: true } } },
  });
  let busyRounds = 0;
  for (const interview of active) {
    try {
      // Repository preparation has no runtime to lock yet. Its lifecycle row
      // still belongs in the metrics response while preparation is in flight.
      if (interview.runtime)
        await withInterviewLock(interview.id, () =>
          snapshotInterviewMetrics(interview.id),
        );
      else await snapshotInterviewMetrics(interview.id);
    } catch (error) {
      if (error instanceof InterviewBusyError) busyRounds++;
      else throw error;
    }
  }
  const runs = await prisma.interviewMetrics.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const total = await prisma.interviewMetrics.count({ where: { userId } });
  return {
    ...aggregateMetrics(runs, pricing),
    selection: {
      includedRounds: runs.length,
      totalRecordedRounds: total,
      limit: 200,
      order: "most recent rounds",
      busyRoundsNotRefreshed: busyRounds,
    },
    runs: runs.map((run) => ({
      interviewId: run.interviewId,
      mode: run.mode,
      problemId: run.problemId,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      summary: run.summary,
    })),
  };
}
