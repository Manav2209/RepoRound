import type {
  InterviewObjective,
  InterviewPhase,
  InterviewState,
  NextInterviewAction,
} from "./interview.types.js";

export const PHASES: InterviewPhase[] = [
  "INTRO",
  "PROJECT_OVERVIEW",
  "ARCHITECTURE",
  "IMPLEMENTATION",
  "DEBUGGING",
  "TRADEOFFS",
  "FINAL",
  "COMPLETED",
];
const policies = {
  INTRO:
    "Briefly summarize the submitted project from repository evidence, then ask one concrete technical question. Do not ask for a project introduction or personal ownership.",
  PROJECT_OVERVIEW:
    "Trace a specific request or state change through the repository. Do not ask what the project does, who uses it, or what the candidate owned.",
  ARCHITECTURE:
    "Ask about boundaries, responsibilities, and failure behavior. Prefer repository evidence.",
  IMPLEMENTATION:
    "Probe actual code, data structures, correctness, and implementation choices.",
  DEBUGGING:
    "Present one realistic failure grounded in the code and ask for a diagnosis.",
  TRADEOFFS:
    "Ask what alternatives were considered and how workload or constraints would change the choice.",
  FINAL: "Thank the candidate and close without scoring them.",
  COMPLETED: "The interview has ended.",
} as const;
export function policyFor(phase: InterviewPhase): string {
  return policies[phase];
}
export function transition(state: InterviewState, phase: InterviewPhase): void {
  if (PHASES.indexOf(phase) < PHASES.indexOf(state.phase))
    throw new Error("Interview phases cannot move backward");
  if (state.phase === "COMPLETED" && phase !== "COMPLETED")
    throw new Error("Completed interview cannot transition");
  state.phase = phase;
}

export function selectObjective(
  state: InterviewState,
  remainingMinutes = 30,
): InterviewObjective | undefined {
  const pending = state.objectives.filter(
    (o) => !["SATISFIED", "INSUFFICIENT"].includes(o.status),
  );
  const phase = Math.min(...pending.map((o) => PHASES.indexOf(o.phase)));
  const available = pending.filter((o) => PHASES.indexOf(o.phase) === phase);
  const priority = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  available.sort((a, b) => priority[b.priority] - priority[a.priority]);
  if (remainingMinutes < 5)
    return (
      pending
        .filter((o) => o.priority === "HIGH")
        .sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase))[0] ??
      available[0]
    );
  return available[0];
}

export function selectNextAction(
  state: InterviewState,
  remainingMinutes: number,
  failedAnalysis = false,
): NextInterviewAction {
  if (state.ended || remainingMinutes <= 0 || state.questions.length >= 40)
    return { type: "END_INTERVIEW" };
  const objective = selectObjective(state, remainingMinutes);
  if (!objective) return { type: "END_INTERVIEW" };
  const current = state.questions.at(-1);
  const claim = [...state.claims]
    .reverse()
    .find(
      (c) =>
        !c.probed &&
        c.topic.toLowerCase() === objective.topic.toLowerCase() &&
        c.status === "CONTRADICTED",
    );
  if (failedAnalysis && current?.objectiveId === objective.id)
    return { type: "ASK_CLARIFICATION", objectiveId: objective.id };
  if (claim)
    return {
      type: "CHALLENGE_DECISION",
      objectiveId: objective.id,
      claimId: claim.id,
    };
  if (objective.phase === "DEBUGGING")
    return { type: "ASK_DEBUGGING", objectiveId: objective.id };
  if (objective.phase === "TRADEOFFS")
    return { type: "CHALLENGE_DECISION", objectiveId: objective.id };
  if (current?.objectiveId !== objective.id)
    return { type: "ASK_NEW_TOPIC", objectiveId: objective.id };
  const weak =
    state.evidence.filter((e) => e.objectiveId === objective.id).at(-1)
      ?.strength === "WEAK";
  return {
    type: weak ? "ASK_CLARIFICATION" : "PROBE_CLAIM",
    objectiveId: objective.id,
  };
}
