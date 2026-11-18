import { voice, type VAD } from "@livekit/agents";
import type {
  llm as llmModule,
  stt as sttModule,
  tts as ttsModule,
} from "@livekit/agents";
import { getLogger } from "../logger.js";
import { VoiceTelemetry, type VoiceMetric } from "./telemetry.js";

export type DomainEvent =
  | { type: "user.speaking"; sessionId: string }
  | { type: "session.started"; sessionId: string }
  | { type: "session.close"; sessionId: string; reason: string }
  | {
      type: "user_input_transcribed";
      transcript: string;
      isFinal: boolean;
      sessionId: string;
    }
  | { type: "agent_state_changed"; state: string; sessionId: string }
  | {
      type: "conversation_item_added";
      role: string;
      text: string | null;
      interrupted: boolean;
      sessionId: string;
    }
  | { type: "response.delta"; text: string; sessionId: string }
  | {
      type: "response.completed";
      fullText: string;
      status: string;
      sessionId: string;
    }
  | { type: "speech.interrupted"; sessionId: string }
  | ({ type: "voice.metrics"; sessionId: string } & VoiceMetric)
  | {
      type: "error";
      error: string;
      detail?: string;
      source?: string;
      recoverable?: boolean;
      sessionId: string;
    };

export interface SessionManagerOptions {
  agent: voice.Agent;
  stt: sttModule.STT;
  llm: llmModule.LLM;
  tts: ttsModule.TTS;
  vad: VAD;
  onEvent?: (ev: DomainEvent) => void;
}

export class SessionManager {
  readonly sessionId: string;
  readonly telemetry: VoiceTelemetry;
  private readonly session: voice.AgentSession;
  private agent: voice.Agent | null = null;
  private readonly onEvent: (ev: DomainEvent) => void;
  private fullText = "";
  private speechConfirmationTimer?: ReturnType<typeof setTimeout>;
  private userSpeechStartedAt?: number;
  private userSpeechConfirmed = false;

  constructor({
    stt,
    llm,
    tts,
    vad,
    onEvent,
  }: Omit<SessionManagerOptions, "agent">) {
    this.sessionId = crypto.randomUUID();
    this.onEvent = onEvent ?? ((): void => {});
    this.telemetry = new VoiceTelemetry((metric) =>
      this.onEvent({
        type: "voice.metrics",
        sessionId: this.sessionId,
        ...metric,
      }),
    );

    this.session = new voice.AgentSession({
      stt,
      llm,
      tts,
      vad,
      turnHandling: {
        preemptiveGeneration: { enabled: false },
        // Silero owns answer boundaries; STT final segments are not complete answers.
        turnDetection: "vad",
        endpointing: { minDelay: 1000, maxDelay: 3000 },
        interruption: {
          mode: "vad",
          enabled: true,
          minDuration: 400,
          minWords: 2,
          resumeFalseInterruption: true,
        },
      },
    });

    const emit = (ev: DomainEvent): void => this.onEvent(ev);

    this.session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (
        this.userSpeechStartedAt !== undefined &&
        !this.userSpeechConfirmed &&
        ev.transcript.trim().split(/\s+/).length >= 2
      ) {
        clearTimeout(this.speechConfirmationTimer);
        const start = this.userSpeechStartedAt;
        this.speechConfirmationTimer = setTimeout(
          () => {
            if (
              this.userSpeechStartedAt === start &&
              !this.userSpeechConfirmed
            ) {
              this.userSpeechConfirmed = true;
              emit({ type: "user.speaking", sessionId: this.sessionId });
            }
          },
          Math.max(0, 400 - (performance.now() - start)),
        );
      }
      emit({
        type: "user_input_transcribed",
        transcript: ev.transcript,
        isFinal: ev.isFinal,
        sessionId: this.sessionId,
      });
    });

    this.session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      if (ev.newState === "thinking") {
        this.fullText = "";
      }
      if (ev.newState === "speaking") {
        // This SDK exposes the active speech for tightly coupled adapters.
        // Without a matching ID we omit the sample rather than pair an old reply.
        const speech = this.session._activity?.currentSpeech;
        if (speech && !speech.interrupted)
          this.telemetry.engineSpeaking(speech.id);
      }
      emit({
        type: "agent_state_changed",
        state: ev.newState,
        sessionId: this.sessionId,
      });
    });

    this.session.on(voice.AgentSessionEventTypes.SpeechCreated, (ev) => {
      const { speechHandle, source } = ev;
      this.telemetry.speechCreated(speechHandle.id, source);
      void speechHandle.waitForPlayout().then(
        () =>
          this.telemetry.speechFinished(
            speechHandle.id,
            speechHandle.interrupted,
          ),
        () => this.telemetry.speechFinished(speechHandle.id, true, true),
      );
    });

    this.session.on(
      voice.AgentSessionEventTypes.ConversationItemAdded,
      (ev) => {
        const interrupted =
          "interrupted" in ev.item
            ? Boolean((ev.item as { interrupted?: boolean }).interrupted)
            : false;
        const item = ev.item;
        if (item.type === "message") {
          const text = item.textContent ?? null;
          const role = String(item.role);
          if (role === "assistant" && interrupted) {
            emit({
              type: "response.completed",
              fullText: text ?? "",
              status: "incomplete",
              sessionId: this.sessionId,
            });
          }
          if (role === "assistant" && !interrupted && text) {
            emit({
              type: "response.completed",
              fullText: text,
              status: "completed",
              sessionId: this.sessionId,
            });
          }
          emit({
            type: "conversation_item_added",
            role,
            text,
            interrupted,
            sessionId: this.sessionId,
          });
        }
      },
    );
    this.session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      clearTimeout(this.speechConfirmationTimer);
      this.userSpeechStartedAt =
        ev.newState === "speaking" ? performance.now() : undefined;
      this.userSpeechConfirmed = false;
      if (ev.newState === "speaking")
        this.telemetry.cancelTurn("worker_user_resumed_speech");
      if (ev.newState === "speaking" && this.session.agentState === "speaking")
        emit({ type: "speech.interrupted", sessionId: this.sessionId });
    });

    this.session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      this.telemetry.cancelTurn("worker_voice_provider_error", undefined, true);
      const source =
        ev.error && typeof ev.error === "object" && "type" in ev.error
          ? String(ev.error.type)
          : "unknown";
      emit({
        type: "error",
        error: describeError(ev),
        detail: describeDetail(ev),
        source,
        recoverable:
          ev.error && typeof ev.error === "object" && "recoverable" in ev.error
            ? Boolean(ev.error.recoverable)
            : undefined,
        sessionId: this.sessionId,
      });
    });
    this.session.on(
      voice.AgentSessionEventTypes.MetricsCollected,
      ({ metrics }) => {
        this.telemetry.providerMetric(metrics);
      },
    );

    this.session.on(voice.AgentSessionEventTypes.Close, (ev) => {
      clearTimeout(this.speechConfirmationTimer);
      this.userSpeechStartedAt = undefined;
      this.telemetry.close();
      emit({
        type: "session.close",
        reason: String(ev.reason),
        sessionId: this.sessionId,
      });
    });
  }

  pushResponseText(text: string): void {
    this.fullText += text;
    this.onEvent({
      type: "response.delta",
      text,
      sessionId: this.sessionId,
    });
  }

  markResponseError(reason: string, turnId?: string): void {
    this.telemetry.cancelTurn("worker_backend_response_failed", turnId, true);
    this.onEvent({
      type: "response.completed",
      fullText: this.fullText,
      status: "failed",
      sessionId: this.sessionId,
    });
    this.onEvent({ type: "error", error: reason, sessionId: this.sessionId });
  }

  setAgent(agent: voice.Agent): void {
    this.agent = agent;
  }

  getAgent(): voice.Agent | null {
    return this.agent;
  }

  async start({ room }: { room: unknown }): Promise<this> {
    const agent = this.agent;
    if (!agent) {
      throw new Error("Agent not set. Call setAgent() before start().");
    }
    const logger = getLogger();
    logger.info({ sessionId: this.sessionId }, "starting agent session");
    await this.session.start({
      agent,
      room: room as Parameters<voice.AgentSession["start"]>[0]["room"],
    });
    this.onEvent({ type: "session.started", sessionId: this.sessionId });
    return this;
  }

  async say(text: string, addToChatCtx = true): Promise<void> {
    await this.session.say(text, { addToChatCtx }).waitForPlayout();
  }

  async close(): Promise<void> {
    this.telemetry.close();
    await this.session.close();
  }
}

export function createSessionManager(
  options: Omit<SessionManagerOptions, "agent">,
): SessionManager {
  return new SessionManager(options);
}

function describeError(ev: { error?: unknown }): string {
  const value = ev.error;
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const inner = (value as { error?: unknown; message?: unknown }).error;
    const msg = (value as { message?: unknown }).message;
    if (inner instanceof Error) return inner.message;
    if (typeof inner === "string") return inner;
    if (typeof msg === "string") return msg;
  }
  return String(value);
}

function describeDetail(ev: { error?: unknown }): string {
  try {
    return JSON.stringify(ev.error ?? ev);
  } catch {
    return "<unserializable>";
  }
}
