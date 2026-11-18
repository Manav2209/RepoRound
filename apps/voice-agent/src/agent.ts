import { voice, type ChatContext } from "@livekit/agents";

export interface AgentOptions {
  instructions: string;
  nextQuestion: (turnId: string, answer: string) => Promise<string | null>;
  onUserTurnCompleted?: (turnId: string) => void;
  onLlmNodeStarted?: (turnId: string) => string | undefined;
  onResponseDelta?: (text: string) => void;
  onResponseError?: (reason: string, turnId?: string) => void;
}

export function buildAgent({
  instructions,
  nextQuestion,
  onUserTurnCompleted,
  onLlmNodeStarted,
  onResponseDelta,
  onResponseError,
}: AgentOptions): voice.Agent {
  return voice.Agent.create({
    instructions,

    onUserTurnCompleted(_ctx, _chatCtx, message) {
      onUserTurnCompleted?.(message.id);
    },

    async *llmNode(
      _ctx: voice.AgentContext,
      chatCtx: ChatContext,
    ): AsyncGenerator<string> {
      let turnId: string | undefined;
      try {
        const last = [...chatCtx.items]
          .reverse()
          .find((item) => item.type === "message" && item.role === "user");
        if (!last || last.type !== "message" || !last.textContent?.trim())
          return;
        turnId = onLlmNodeStarted?.(last.id) ?? last.id;
        const question = await nextQuestion(turnId, last.textContent.trim());
        if (question === null) return;
        onResponseDelta?.(question);
        yield question;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const reason = err instanceof Error ? err.message : String(err);
        onResponseError?.(reason, turnId);
        yield "Sorry, I couldn't process that answer. Please repeat it in a moment.";
      }
    },
  });
}
