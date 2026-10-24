import type { InterviewState } from "./interview.types.js";

export interface MemoryFact {
  id: string;
  sourceTurnId: string;
  questionId: string;
  objectiveId: string;
  topic: string;
  text: string;
  observedAt: string;
  provenance: "candidate_answer";
  confidence: number;
  verification: "candidate_claim" | "supported" | "contradicted" | "uncertain";
  probed: boolean;
}

/** A bounded, replayable projection of the analyzer's canonical output. */
export function deriveMemoryFacts(
  state: InterviewState,
  observedAt = new Date().toISOString(),
): MemoryFact[] {
  const prior = new Map((state.memoryFacts ?? []).map((fact) => [fact.id, fact]));
  const questions = new Map(
    state.questions
      .filter((question) => question.answerTurnId)
      .map((question) => [question.answerTurnId!, question]),
  );
  const base = (id: string, sourceTurnId: string, topic: string, text: string) => {
    const question = questions.get(sourceTurnId);
    return {
      id,
      sourceTurnId,
      questionId: question?.id ?? "",
      objectiveId: question?.objectiveId ?? "",
      topic: topic.slice(0, 100),
      text: text.slice(0, 300),
      observedAt: prior.get(id)?.observedAt ?? observedAt,
      provenance: "candidate_answer" as const,
    };
  };
  const claims: MemoryFact[] = state.claims.map((claim) => ({
    ...base(claim.id, claim.sourceTurnId, claim.topic, claim.statement),
    confidence: claim.confidence ?? 0.5,
    verification:
      claim.status === "SUPPORTED"
        ? "supported"
        : claim.status === "CONTRADICTED"
          ? "contradicted"
          : claim.status === "NOT_VERIFIABLE"
            ? "uncertain"
            : "candidate_claim",
    probed: claim.probed ?? false,
  }));
  const evidence: MemoryFact[] = state.evidence.map((item) => ({
    ...base(item.id, item.sourceTurnId, item.topic, item.evidence),
    confidence: item.confidence ?? 0.5,
    verification: "candidate_claim",
    probed: false,
  }));
  const design: MemoryFact[] = (state.systemDesign?.answerAssessments ?? [])
    .filter((item) => item.claimedGuaranteeOrTradeoff.trim())
    .map((item) => ({
      ...base(
        `design_${item.turnId}`,
        item.turnId,
        item.concern,
        item.claimedGuaranteeOrTradeoff,
      ),
      questionId: item.questionId,
      objectiveId: `design_${item.concern.toLowerCase()}`,
      confidence: item.strength === "STRONG" ? 0.8 : item.strength === "MODERATE" ? 0.6 : 0.4,
      verification: "candidate_claim",
      probed: false,
    }));
  return [...claims, ...evidence, ...design].slice(-120);
}
