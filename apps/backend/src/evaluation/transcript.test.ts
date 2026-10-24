import { expect, test } from "bun:test";
import { selectEvaluationTurns } from "./transcript.js";
import type { EvaluationContext } from "./evaluation.types.js";

const turn = (
  index: number,
  text: string,
): EvaluationContext["transcript"][number] => ({
  id: `turn-${index}`,
  role: "user",
  text,
  questionId: `question-${index}`,
});
const payload = (turns: EvaluationContext["transcript"]) =>
  turns.map((t, answerIndex) => ({ answerIndex, text: t.text }));

test("more than 100 short answers are all retained without a false partial flag", () => {
  const turns = Array.from({ length: 151 }, (_, i) => turn(i, `Answer ${i}`));
  const selected = selectEvaluationTurns(turns, [], 32000);
  expect(selected.turns).toEqual(turns);
  expect(selected.coverage).toEqual({
    totalTurns: 151,
    includedTurns: 151,
    omittedTurns: 0,
    truncatedTurns: 0,
    quality: "complete",
  });
});

test("long answers share the budget, preserve final reasoning, and report shortened turns", () => {
  const turns = Array.from({ length: 30 }, (_, i) =>
    turn(i, `start-${i} ` + "x".repeat(3000) + ` end-${i}`),
  );
  const selected = selectEvaluationTurns(turns, [], 32000);
  expect(selected.turns).toHaveLength(30);
  expect(selected.turns[29]!.text).toContain("start-29");
  expect(selected.turns[29]!.text).toContain("end-29");
  expect(selected.coverage).toMatchObject({
    omittedTurns: 0,
    truncatedTurns: 30,
    quality: "partial",
  });
  expect(JSON.stringify(payload(selected.turns)).length).toBeLessThanOrEqual(
    32000,
  );
});

test("JSON escaping is counted in the budget and selection is deterministic", () => {
  const turns = Array.from({ length: 50 }, (_, i) =>
    turn(i, '\u0000"\\'.repeat(1500)),
  );
  const first = selectEvaluationTurns(turns, [], 10000);
  expect(first).toEqual(selectEvaluationTurns(turns, [], 10000));
  expect(JSON.stringify(payload(first.turns)).length).toBeLessThanOrEqual(
    10000,
  );
  expect(first.coverage.quality).toBe("partial");
});

test("omitted answers are counted; the latest response has priority under extreme pressure", () => {
  const turns = Array.from({ length: 50 }, (_, i) =>
    turn(i, `response ${i}: ` + "x".repeat(500)),
  );
  const selected = selectEvaluationTurns(turns, [], 600);
  expect(selected.turns.at(-1)!.id).toBe("turn-49");
  expect(selected.coverage.omittedTurns).toBe(50 - selected.turns.length);
  expect(selected.coverage.quality).toBe("partial");
});

test("assistant messages and empty candidate messages do not spend candidate evidence budget", () => {
  const selected = selectEvaluationTurns(
    [
      { id: "ai", role: "assistant", text: "question".repeat(2000) },
      turn(0, "   "),
      turn(1, "Actual answer"),
    ],
    [],
    1000,
  );
  expect(selected.turns.map((t) => t.id)).toEqual(["turn-1"]);
  expect(selected.coverage.totalTurns).toBe(1);
});
