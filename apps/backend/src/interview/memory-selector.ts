import type {
  CandidateClaim,
  CandidateEvidence,
  InterviewObjective,
  InterviewState,
} from "./interview.types.js";
import type { MemoryFact } from "./memory-facts.js";

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter((term) => term.length > 2)
    .slice(0, 10);
}

function overlap(text: string, target: string[]): number {
  if (!target.length) return 0;
  const lowered = text.toLowerCase();
  return target.filter((term) => lowered.includes(term)).length;
}

export function selectRelevantClaims(
  state: InterviewState,
  objective: InterviewObjective,
  limit = 6,
): CandidateClaim[] {
  const target = terms(`${objective.topic} ${objective.description}`);
  const last = Math.max(1, state.claims.length - 1);
  return state.claims
    .map((claim, index) => {
      const status =
        claim.status === "CONTRADICTED"
          ? 3
          : claim.status === "SUPPORTED"
            ? 1
            : 0;
      const score =
        overlap(`${claim.topic} ${claim.statement}`, target) * 3 +
        status -
        (claim.probed ? 1 : 0) +
        index / last;
      return { claim, score, index };
    })
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .map(({ claim }) => claim);
}

export function selectRelevantEvidence(
  state: InterviewState,
  objective: InterviewObjective,
  limit = 6,
): CandidateEvidence[] {
  const target = terms(`${objective.topic} ${objective.description}`);
  const last = Math.max(1, state.evidence.length - 1);
  return state.evidence
    .map((evidence, index) => {
      const score =
        (evidence.objectiveId === objective.id ? 5 : 0) +
        overlap(`${evidence.topic} ${evidence.evidence}`, target) * 2 +
        (evidence.strength === "STRONG"
          ? 2
          : evidence.strength === "MODERATE"
            ? 1
            : 0) +
        index / last;
      return { evidence, score, index };
    })
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .map(({ evidence }) => evidence);
}

export function selectRelevantMemoryFacts(
  state: InterviewState,
  targetText: string,
  limit = 4,
): MemoryFact[] {
  const target = terms(targetText);
  const facts = state.memoryFacts ?? [];
  return facts
    .map((fact, index) => ({
      fact,
      index,
      score: overlap(`${fact.topic} ${fact.text}`, target) * 3 +
        (fact.probed ? -2 : 0) +
        (fact.verification === "contradicted" ? 2 : 0) +
        index / Math.max(1, facts.length - 1),
    }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .map(({ fact }) => fact);
}
