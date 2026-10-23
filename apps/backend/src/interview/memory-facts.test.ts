import { expect, test } from "bun:test";
import { deriveMemoryFacts } from "./memory-facts.js";
import { selectRelevantMemoryFacts } from "./memory-selector.js";
import { initialSystemDesignState } from "./schemas.js";

test("facts keep stable sources and do not promote candidate statements to verified truth", () => {
  const state = initialSystemDesignState({ problemId: "url-shortener", objectives: [] });
  state.questions.push({
    id: "q1", text: "How do you handle cache failure?", objectiveId: "cache",
    phase: "ARCHITECTURE", difficulty: "HARD", reason: "PROBE",
    askedAt: "2026-10-22T00:00:00.000Z", answerTurnId: "turn1",
  });
  state.claims.push({ id: "claim_turn1_0", sourceTurnId: "turn1", topic: "cache recovery", statement: "The cache never fails", status: "UNVERIFIED" });
  state.evidence.push({ id: "ev_turn1_0", sourceTurnId: "turn1", objectiveId: "cache", skill: "recovery", topic: "cache recovery", evidence: "Fallback to the database", strength: "STRONG" });
  const first = deriveMemoryFacts(state, "2026-10-22T01:00:00.000Z");
  expect(first.map((fact) => fact.id)).toEqual(["claim_turn1_0", "ev_turn1_0"]);
  expect(first[0]).toMatchObject({ questionId: "q1", sourceTurnId: "turn1", verification: "candidate_claim" });
  state.memoryFacts = first;
  state.claims[0]!.status = "CONTRADICTED";
  const second = deriveMemoryFacts(state, "2026-10-22T02:00:00.000Z");
  expect(second[0]).toMatchObject({ observedAt: first[0]!.observedAt, verification: "contradicted" });
  expect(second[1]!.verification).toBe("candidate_claim");
});

test("older relevant fact wins over a recent unrelated one", () => {
  const state = initialSystemDesignState({ problemId: "url-shortener", objectives: [] });
  state.memoryFacts = [
    { id: "older", sourceTurnId: "t1", questionId: "q1", objectiveId: "cache", topic: "cache invalidation", text: "Fallback to the database on cache misses", observedAt: "2026-10-22", provenance: "candidate_answer", confidence: 0.6, verification: "candidate_claim", probed: false },
    { id: "recent", sourceTurnId: "t2", questionId: "q2", objectiveId: "auth", topic: "login", text: "Users sign in with email", observedAt: "2026-10-22", provenance: "candidate_answer", confidence: 0.6, verification: "candidate_claim", probed: false },
  ];
  expect(selectRelevantMemoryFacts(state, "cache invalidation", 1)[0]!.id).toBe("older");
});
