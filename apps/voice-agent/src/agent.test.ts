/// <reference types="bun" />
import { expect, test } from "bun:test";
import { llm } from "@livekit/agents";
import { buildAgent } from "./agent.js";

test("a silent checkpoint yields no TTS input, while unflagged questions still speak", async () => {
  const chat = llm.ChatContext.empty();
  const message = chat.addMessage({
    id: "turn1",
    role: "user",
    content: "A technical answer",
  });
  const committed: string[] = [];
  const silent = buildAgent({
    instructions: "Use backend questions",
    nextQuestion: async () => null,
    onUserTurnCompleted: (turnId) => committed.push(turnId),
  });
  await silent.onUserTurnCompleted(chat, message);
  const stream = await silent.llmNode(chat, llm.ToolContext.empty(), {});
  expect(await stream!.getReader().read()).toMatchObject({ done: true });
  expect(committed).toEqual(["turn1"]);

  const normal = buildAgent({
    instructions: "Use backend questions",
    nextQuestion: async () => "How does your queue handle retries?",
  });
  const spoken = await normal.llmNode(chat, llm.ToolContext.empty(), {});
  expect(await spoken!.getReader().read()).toMatchObject({
    done: false,
    value: "How does your queue handle retries?",
  });
});

test("backend errors preserve turn correlation for cancellation telemetry", async () => {
  const chat = llm.ChatContext.empty();
  chat.addMessage({
    id: "turn-error",
    role: "user",
    content: "A technical answer",
  });
  let erroredTurn: string | undefined;
  const agent = buildAgent({
    instructions: "Use backend questions",
    nextQuestion: async () => {
      throw new Error("backend unavailable");
    },
    onResponseError: (_reason, turnId) => {
      erroredTurn = turnId;
    },
  });
  const stream = await agent.llmNode(chat, llm.ToolContext.empty(), {});
  expect((await stream!.getReader().read()).value).toContain(
    "couldn't process that answer",
  );
  expect(erroredTurn).toBe("turn-error");
});

test("a cancelled turn produces no apology speech or processing-error event", async () => {
  const chat = llm.ChatContext.empty();
  chat.addMessage({
    id: "cancelled",
    role: "user",
    content: "Continuing an answer",
  });
  let errors = 0;
  const agent = buildAgent({
    instructions: "Use backend questions",
    nextQuestion: async () => {
      throw new DOMException("Superseded", "AbortError");
    },
    onResponseError: () => {
      errors++;
    },
  });
  const stream = await agent.llmNode(chat, llm.ToolContext.empty(), {});
  expect(await stream!.getReader().read()).toMatchObject({ done: true });
  expect(errors).toBe(0);
});
