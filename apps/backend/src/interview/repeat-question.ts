import type { InterviewState, QuestionRecord } from "./interview.types.js";

/** Recognize a conversation control request, not an answer mentioning repetition. */
export function isRepeatRequest(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:(?:sorry|please|hey|okay|ok)\s+)*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:repeat(?: (?:that|it|(?:(?:the|your|that) )?(?:(?:last|previous|current) )?question))?(?: (?:again|please|for me))*|(?:say|ask) (?:that|it|(?:(?:the|your|that) )?(?:(?:last|previous|current) )?question) again(?: please)?|(?:i (?:didn't|did not|couldn't|could not) (?:hear|catch|understand) (?:that|it|the question))(?: (?:can|could) you repeat (?:it|that|the question))?)$/.test(
    normalized,
  );
}

export function questionToRepeat(
  state: InterviewState,
): QuestionRecord | undefined {
  const pending =
    state.systemDesign?.pendingQuestionId ?? state.repeatedQuestionId;
  const current =
    state.questions.find((question) => question.id === pending) ??
    state.questions.at(-1);
  // Diagram checkpoints are UI choices; "repeat the question" refers to the
  // substantive interview question that preceded them.
  return current?.checkpoint
    ? [...state.questions].reverse().find((question) => !question.checkpoint)
    : current;
}
