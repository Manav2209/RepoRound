import type {
  EvaluationContext,
  EvaluationCoverage,
} from "./evaluation.types.js";

type Turn = EvaluationContext["transcript"][number];
const MARKER = "\n[Middle of answer omitted for input budget]\n";

function excerpt(text: string, maxEncodedLength: number): string {
  if (JSON.stringify(text).length <= maxEncodedLength) return text;
  let low = 0;
  let high = text.length;
  let best = "";
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const head = Math.ceil(length / 2);
    const tail = Math.floor(length / 2);
    const candidate =
      text.slice(0, head) + MARKER + (tail ? text.slice(-tail) : "");
    if (JSON.stringify(candidate).length <= maxEncodedLength) {
      best = candidate;
      low = length + 1;
    } else high = length - 1;
  }
  return best;
}

/** Share the budget across candidate answers, keeping their starts and ends.
 * If even minimal excerpts cannot fit, favor recent answers and report omissions.
 * Budget uses JSON lengths, so quotes/control characters cannot evade it.
 */
export function selectEvaluationTurns(
  turns: Turn[],
  questions: EvaluationContext["questionHistory"],
  budget: number,
): { turns: Turn[]; coverage: EvaluationCoverage } {
  const candidates = turns.filter((t) => t.role === "user" && t.text.trim());
  const cost = (turn: Turn, text: string, index: number) =>
    JSON.stringify({
      answerIndex: index,
      question: questions.find((q) => q.id === turn.questionId)?.text,
      text,
    }).length + 1;
  let remaining = Math.max(0, budget - 2);
  const selected: Array<{ turn: Turn; index: number; text: string }> = [];
  for (let index = candidates.length - 1; index >= 0; index--) {
    const turn = candidates[index]!;
    const text = excerpt(
      turn.text,
      Math.min(JSON.stringify(turn.text).length, 256),
    );
    const size = cost(turn, text, index);
    if (text && size <= remaining) {
      selected.push({ turn, index, text });
      remaining -= size;
    }
  }
  selected.sort((a, b) => a.index - b.index);
  // Water-fill the remaining budget; short answers leave capacity for longer ones.
  let pending = selected.filter((item) => item.text !== item.turn.text);
  while (pending.length && remaining >= pending.length) {
    const share = Math.floor(remaining / pending.length);
    let used = 0;
    for (const item of pending) {
      const before = JSON.stringify(item.text).length;
      const text = excerpt(item.turn.text, before + share);
      const added = JSON.stringify(text).length - before;
      if (added > 0) {
        item.text = text;
        used += added;
      }
    }
    if (!used) break;
    remaining -= used;
    pending = pending.filter((item) => item.text !== item.turn.text);
  }
  const truncatedTurns = selected.filter(
    (item) => item.text !== item.turn.text,
  ).length;
  const omittedTurns = candidates.length - selected.length;
  return {
    turns: selected.map((item) => ({ ...item.turn, text: item.text })),
    coverage: {
      totalTurns: candidates.length,
      includedTurns: selected.length,
      omittedTurns,
      truncatedTurns,
      quality: omittedTurns || truncatedTurns ? "partial" : "complete",
    },
  };
}
