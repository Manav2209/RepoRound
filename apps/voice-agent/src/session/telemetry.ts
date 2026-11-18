import type { AgentMetrics } from "@livekit/agents";

/** Durations use the worker's monotonic clock unless supplied by the SDK. */
export interface VoiceMetric {
  source: string;
  durationMs: number;
  turnId?: string;
  questionId?: string;
  speechId?: string;
  requestId?: string;
  firstAudioMs?: number;
  intentionalDelayMs?: number;
  adjustedDurationMs?: number;
  transcriptionDelayMs?: number;
  audioSeconds?: number;
  charactersCount?: number;
  requestCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelProvider?: string;
  modelName?: string;
  failed?: boolean;
  cancelled?: boolean;
  streamed?: boolean;
  attempt?: number;
  measurementKind?: string;
}

type Turn = {
  turnId: string;
  questionId?: string;
  speechId?: string;
  committedAt: number;
  ready: boolean;
  readyAt?: number;
};

const nonnegative = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

/** Tracks correlations without storing transcript or question text. */
export class VoiceTelemetry {
  private pending?: Turn;
  private readonly speechTurns = new Map<string, Turn>();
  private readonly seenProviderRequests = new Set<string>();
  private startup?: {
    startedAt: number;
    intentionalDelayMs: number;
    waitingForSpeech: boolean;
    speechId?: string;
    questionId?: string;
  };

  constructor(
    private readonly sink: (metric: VoiceMetric) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  private emit(metric: VoiceMetric): void {
    // Telemetry must never turn a successful interview operation into a failure.
    try {
      this.sink(metric);
    } catch {
      /* best effort */
    }
  }

  beginStartup(startedAt = this.now()): void {
    this.startup = {
      startedAt,
      intentionalDelayMs: 0,
      waitingForSpeech: false,
    };
  }

  addIntentionalDelay(durationMs: number): void {
    if (this.startup)
      this.startup.intentionalDelayMs += nonnegative(durationMs) ?? 0;
  }

  expectOpening(questionId?: string): void {
    if (!this.startup) return;
    this.startup.waitingForSpeech = true;
    this.startup.questionId = questionId;
  }

  skipStartup(): void {
    // A resumed UI-only checkpoint expects no opening audio. A later question
    // must not be mislabeled as startup latency or a startup failure.
    this.startup = undefined;
  }

  turnCommitted(turnId: string, questionId?: string): void {
    if (this.pending?.turnId === turnId) return;
    this.cancelTurn("worker_turn_superseded");
    this.pending = {
      turnId,
      questionId,
      committedAt: this.now(),
      ready: false,
    };
  }

  responseReady(turnId: string, questionId?: string): void {
    if (this.pending?.turnId !== turnId) return;
    this.pending.ready = true;
    this.pending.readyAt = this.now();
    this.pending.questionId = questionId;
  }

  nodeEntered(turnId: string): void {
    if (this.pending?.turnId !== turnId) return;
    this.emit({
      source: "node_entry",
      turnId,
      durationMs: Math.max(0, this.now() - this.pending.committedAt),
      measurementKind: "worker_commit_to_custom_llm_node",
    });
  }

  textHandoff(turnId: string): void {
    if (this.pending?.turnId !== turnId || this.pending.readyAt === undefined)
      return;
    this.emit({
      source: "text_handoff",
      turnId,
      durationMs: Math.max(0, this.now() - this.pending.readyAt),
      measurementKind: "worker_backend_ready_to_text_yield",
    });
  }

  speechCreated(speechId: string, source: string): void {
    if (source === "say" && this.startup?.waitingForSpeech) {
      this.startup.speechId = speechId;
      this.startup.waitingForSpeech = false;
    }
    if (source !== "generate_reply" || !this.pending || this.pending.speechId)
      return;
    this.pending.speechId = speechId;
    this.speechTurns.set(speechId, this.pending);
    if (this.speechTurns.size > 128)
      this.speechTurns.delete(this.speechTurns.keys().next().value!);
  }

  /** SDK activity ID identifies the speech actually entering engine playback. */
  engineSpeaking(speechId: string | undefined): void {
    if (!speechId) return;
    if (this.startup?.speechId === speechId) {
      const startup = this.startup;
      const durationMs = Math.max(0, this.now() - startup.startedAt);
      this.startup = undefined;
      this.emit({
        source: "startup",
        durationMs,
        intentionalDelayMs: startup.intentionalDelayMs,
        adjustedDurationMs: Math.max(
          0,
          durationMs - startup.intentionalDelayMs,
        ),
        questionId: startup.questionId,
        speechId,
        failed: false,
        measurementKind: "worker_entry_to_engine_speaking_proxy",
      });
    }
    const turn = this.pending;
    if (!turn || turn.speechId !== speechId || !turn.ready) return;
    if (turn.readyAt !== undefined)
      this.emit({
        source: "response_render_start",
        turnId: turn.turnId,
        questionId: turn.questionId,
        speechId,
        durationMs: Math.max(0, this.now() - turn.readyAt),
        measurementKind: "worker_backend_ready_to_engine_speaking_proxy",
      });
    this.pending = undefined;
    this.emit({
      source: "response_start",
      durationMs: Math.max(0, this.now() - turn.committedAt),
      turnId: turn.turnId,
      questionId: turn.questionId,
      speechId,
      failed: false,
      measurementKind: "worker_committed_turn_to_engine_speaking_proxy",
    });
  }

  cancelTurn(measurementKind: string, turnId?: string, failed = false): void {
    if (!this.pending || (turnId && this.pending.turnId !== turnId)) return;
    const turn = this.pending;
    this.pending = undefined;
    this.emit({
      source: "response_cancelled",
      durationMs: Math.max(0, this.now() - turn.committedAt),
      turnId: turn.turnId,
      questionId: turn.questionId,
      speechId: turn.speechId,
      cancelled: true,
      failed,
      measurementKind,
    });
  }

  speechFinished(speechId: string, interrupted: boolean, failed = false): void {
    if (interrupted && this.pending?.speechId === speechId)
      this.cancelTurn(
        "worker_speech_cancelled_before_start",
        undefined,
        failed,
      );
  }

  close(): void {
    this.cancelTurn("worker_session_closed_before_response");
    if (!this.startup) return;
    const startup = this.startup;
    this.startup = undefined;
    const durationMs = Math.max(0, this.now() - startup.startedAt);
    this.emit({
      source: "startup",
      durationMs,
      intentionalDelayMs: startup.intentionalDelayMs,
      adjustedDurationMs: Math.max(0, durationMs - startup.intentionalDelayMs),
      failed: true,
      measurementKind: "worker_startup_without_engine_speaking",
    });
  }

  private requestCount(source: string, requestId: string): number | undefined {
    if (!requestId) return undefined;
    const key = `${source}:${requestId}`;
    if (this.seenProviderRequests.has(key)) return 0;
    this.seenProviderRequests.add(key);
    return 1;
  }

  providerMetric(metrics: AgentMetrics): void {
    if (metrics.type === "tts_metrics") {
      const turn = metrics.speechId
        ? this.speechTurns.get(metrics.speechId)
        : undefined;
      this.emit({
        source: "tts",
        durationMs: nonnegative(metrics.durationMs) ?? 0,
        firstAudioMs: nonnegative(metrics.ttfbMs),
        audioSeconds: (nonnegative(metrics.audioDurationMs) ?? 0) / 1000,
        charactersCount: nonnegative(metrics.charactersCount),
        inputTokens: nonnegative(metrics.inputTokens),
        outputTokens: nonnegative(metrics.outputTokens),
        requestId: metrics.requestId || undefined,
        speechId: metrics.speechId,
        turnId: turn?.turnId,
        questionId: turn?.questionId,
        requestCount: this.requestCount("tts", metrics.requestId),
        cancelled: metrics.cancelled,
        streamed: metrics.streamed,
        modelProvider: metrics.metadata?.modelProvider,
        modelName: metrics.metadata?.modelName,
        measurementKind: "sdk_tts_synthesis",
      });
      return;
    }
    if (metrics.type === "stt_metrics") {
      this.emit({
        source: "stt",
        durationMs: nonnegative(metrics.durationMs) ?? 0,
        audioSeconds: (nonnegative(metrics.audioDurationMs) ?? 0) / 1000,
        requestId: metrics.requestId || undefined,
        requestCount: this.requestCount("stt", metrics.requestId),
        streamed: metrics.streamed,
        inputTokens: nonnegative(metrics.inputTokens),
        outputTokens: nonnegative(metrics.outputTokens),
        modelProvider: metrics.metadata?.modelProvider,
        modelName: metrics.metadata?.modelName,
        measurementKind: metrics.streamed
          ? "sdk_streaming_stt_usage_not_latency"
          : "sdk_stt_request",
      });
      return;
    }
    if (metrics.type === "eou_metrics") {
      const turn = metrics.speechId
        ? this.speechTurns.get(metrics.speechId)
        : undefined;
      this.emit({
        source: "end_of_utterance",
        durationMs: nonnegative(metrics.endOfUtteranceDelayMs) ?? 0,
        transcriptionDelayMs: nonnegative(metrics.transcriptionDelayMs),
        speechId: metrics.speechId,
        turnId: turn?.turnId,
        questionId: turn?.questionId,
        measurementKind: "sdk_vad_end_to_turn_finalization",
      });
    }
  }
}
