import { expect, test } from "bun:test";
import { isRepeatRequest, questionToRepeat } from "./repeat-question.js";
import { initialState, initialSystemDesignState } from "./schemas.js";
import type { QuestionRecord } from "./interview.types.js";

test.each([
  "Can you repeat the question?",
  "Sorry. Can you repeat the question?",
  "Could you please repeat that?",
  "Could you repeat the last question for me, please?",
  "Please repeat.",
  "Repeat the previous question please.",
  "Say that again.",
  "I didn't catch the question. Can you repeat it?",
])("recognizes the conversation control request: %s", (text) => {
  expect(isRepeatRequest(text)).toBe(true);
});

test.each([
  "We repeat the request until the database acknowledges it.",
  "Can you repeat the question? I would use a queue to handle retries.",
  "The retry policy repeats a failed message.",
  "Please repeat the message before persisting it.",
  "Continue to the next question.",
])("does not discard an engineering answer: %s", (text) => {
  expect(isRepeatRequest(text)).toBe(false);
});

const question: QuestionRecord = {
  id: "q1",
  text: "How do messages reach offline recipients?",
  objectiveId: "flow",
  phase: "ARCHITECTURE",
  difficulty: "MEDIUM",
  reason: "NEW_TOPIC",
  askedAt: new Date().toISOString(),
};

test("a diagram checkpoint repeats the last substantive question without mutating state", () => {
  const state = initialSystemDesignState({
    problemId: "chat-system",
    objectives: [],
  });
  state.questions.push(question, {
    ...question,
    id: "checkpoint",
    text: "Would you like to update your diagram?",
    checkpoint: true,
  });
  state.systemDesign!.pendingQuestionId = "checkpoint";
  const before = structuredClone(state);
  expect(questionToRepeat(state)?.id).toBe("q1");
  expect(state).toEqual(before);
});

test("repository interviews repeat their current question", () => {
  const state = initialState(
    [
      {
        id: "flow",
        phase: "ARCHITECTURE",
        topic: "Message delivery",
        description: "Trace delivery",
        targetEvidence: ["Delivery mechanism"],
        priority: "HIGH",
        status: "NOT_STARTED",
        attempts: 0,
        evidenceIds: [],
      },
    ],
    "mid",
  );
  state.questions.push(question);
  expect(questionToRepeat(state)?.text).toBe(question.text);
});
