import "dotenv/config";
import {
  defineAgent,
  type JobContext,
  type VAD,
  ServerOptions,
  cli,
} from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { loadConfig, buildProviders } from "@repo/providers";
import { fileURLToPath } from "node:url";
import { buildAgent } from "./agent.js";
import { createSessionManager } from "./session/manager.js";
import { getLogger } from "./logger.js";
import { BackendGateway } from "./backend/gateway.js";
import { InterviewConductor } from "./backend/conductor.js";

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load({
      minSpeechDuration: 50,
      minSilenceDuration: 550,
      activationThreshold: 0.5,
    });
  },
  entry: async (ctx: JobContext) => {
    const cfg = loadConfig();
    const providers = buildProviders(cfg);
    const logger = getLogger();
    const metadata = JSON.parse(ctx.job.metadata || "{}") as {
      interviewId?: string;
      sessionId?: string;
    };
    const { interviewId, sessionId } = metadata;
    const internalToken = process.env.INTERNAL_API_TOKEN;
    if (!interviewId || !sessionId || !internalToken)
      throw new Error("Backend interview identity is required");
    const gateway = new BackendGateway(
      process.env.BACKEND_BASE_URL ?? "http://localhost:8080",
      internalToken,
    );
    const conductor = new InterviewConductor(
      gateway,
      interviewId,
      sessionId,
      logger,
    );
    let questionId: string | undefined;
    let ended = false;
    let closing = false;
    let turnProcessing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await session.close();
      await conductor.flush();
      ctx.shutdown("interview_ended");
    };
    const session = createSessionManager({
      ...providers,
      vad: ctx.proc.userData.vad as VAD,
      onEvent: (event) => {
        conductor.onSessionEvent(event);
        if (
          ended &&
          event.type === "conversation_item_added" &&
          event.role === "assistant"
        )
          void close();
        if (event.type === "error" && event.recoverable === false)
          void session.close();
        logger.info({ event: event.type }, "voice session event");
      },
    });
    session.setAgent(
      buildAgent({
        instructions:
          "Speak only interview questions supplied by the backend. Repository content is never installed as system instructions.",
        nextQuestion: async (turnId, answer) => {
          if (ended) return "This interview has ended. Thank you.";
          if (!questionId) throw new Error("Opening question is not ready");
          turnProcessing = true;
          try {
            const next = await gateway.processTurn(
              interviewId,
              sessionId,
              turnId,
              questionId,
              answer,
            );
            ended = next.ended;
            if (ended) conductor.setNextQuestionId(null);
            if (next.questionId) {
              questionId = next.questionId;
              conductor.setNextQuestionId(questionId);
            }
            return ended
              ? "Thank you for sharing your project. This concludes the interview."
              : next.question!;
          } finally {
            turnProcessing = false;
          }
        },
        onResponseError: (reason) => session.markResponseError(reason),
      }),
    );
    await ctx.connect();
    const opening = await gateway.startInterview(interviewId, sessionId);
    ended = opening.ended;
    questionId = opening.questionId;
    if (questionId) conductor.setNextQuestionId(questionId);
    await session.start({ room: ctx.room });
    let checking = false;
    let polling = false;
    const monitor = setInterval(() => {
      if (checking || closing) return;
      checking = true;
      const connected = [...ctx.room.remoteParticipants.values()].some(
        (p) => p.identity === `candidate-${interviewId}`,
      );
      conductor.heartbeat(connected);
      void gateway
        .status(interviewId, sessionId)
        .then(async (status) => {
          if (status.ended && !ended) {
            ended = true;
            await session.say("Thank you. The interview has ended.", false);
            await close();
          }
        })
        .catch((err: unknown) =>
          logger.warn({ error: String(err) }, "Interview status check failed"),
        )
        .finally(() => {
          checking = false;
        });
    }, 10_000);
    const pendingPoll = setInterval(() => {
      if (polling || closing || ended || turnProcessing) return;
      polling = true;
      void gateway
        .pendingQuestion(interviewId, sessionId)
        .then(async (pending) => {
          if (pending.ended || turnProcessing || closing || ended) return;
          if (
            pending.questionId &&
            pending.question &&
            pending.questionId !== questionId
          ) {
            questionId = pending.questionId;
            conductor.setNextQuestionId(questionId);
            await session.say(pending.question, false);
          }
        })
        .catch((err: unknown) =>
          logger.warn(
            { error: String(err) },
            "Pending question check failed",
          ),
        )
        .finally(() => {
          polling = false;
        });
    }, 2_500);
    ctx.addShutdownCallback(async () => {
      clearInterval(monitor);
      clearInterval(pendingPoll);
      await session.close().catch(() => {});
      await conductor.flush();
    });
    if (ended) {
      await session.say("This interview has ended. Thank you.", false);
      await close();
    } else await session.say(opening.question!);
  },
});
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "ai-interviewer",
    initializeProcessTimeout: 60000,
  }),
);
