export interface EvaluationDimensions {
  technicalKnowledge: number | null;
  problemSolving: number | null;
  communication: number | null;
  projectUnderstanding: number | null;
  depth: number | null;
}

/** Counts refer to nonempty candidate turns, not assistant messages. */
export interface EvaluationCoverage {
  totalTurns: number;
  includedTurns: number;
  omittedTurns: number;
  truncatedTurns: number;
  quality: "complete" | "partial";
}

export interface Evaluation {
  coverage?: EvaluationCoverage;
  score: number | null;
  dimensions: EvaluationDimensions;
  strengths: string[];
  weaknesses: string[];
  feedback: string;
  evidence: Record<
    string,
    {
      level: string;
      confidence: number;
      evidenceIds: string[];
      explanation: string;
      score?: number | null;
      observations?: { turnId: string; quote: string }[];
    }
  >;
}

export interface EvaluationContext {
  projectContext: {
    owner: string;
    name: string;
    projectSummary: string;
    technologies: string[];
    architecture: string;
    importantFiles: { path: string; reason: string }[];
    evidence: { claim: string; source: string }[];
  };
  plan: {
    role: string;
    difficulty: string;
    topics: string[];
    objectives: {
      id: string;
      topic: string;
      description: string;
      status?: string;
      kind?: string;
      phase?: string;
    }[];
  };
  github?: {
    segment: string;
    mainQuestionsAsked: number;
    mainQuestionsTarget: number;
    followUpsAsked: number;
    appliedQuestionsAsked: number;
  };
  transcript: {
    id: string;
    role: "user" | "assistant";
    text: string;
    questionId?: string | null;
  }[];
  systemDesign?: {
    problemTitle: string;
    problemVersion: number;
    brief: string;
    requirements: string[];
    loadAssumption: string;
    constraints: string[];
    challenge: string;
    probesAsked: string[];
    challengeIssued: boolean;
    revisionSubmitted: boolean;
    questionCount: number;
    questionTarget: number;
    failureAsked: boolean;
    revisions: {
      revision: number;
      nodeCount: number;
      edgeCount: number;
      nodes: {
        id: string;
        label: string;
        componentType: string;
      }[];
      edges: {
        source: { id: string; label: string };
        target: { id: string; label: string };
      }[];
      diff?: import("@repo/voice-types").ArchitectureRevisionDiff;
    }[];
    answerAssessments: {
      questionId: string;
      revision: number;
      strength: string;
      concern: string;
      addressedQuestion: boolean;
      consistentWithDiagram: boolean;
      claimedGuaranteeOrTradeoff: string;
      unresolvedAssumption?: string;
    }[];
    checkpoints: {
      questionId: string;
      status: string;
      afterFailure: boolean;
      choice?: string;
      submittedRevision?: number;
    }[];
  };
  candidateEvidence: import("../interview/interview.types.js").CandidateEvidence[];
  claims?: import("../interview/interview.types.js").CandidateClaim[];
  skills?: Record<string, import("../interview/interview.types.js").SkillState>;
  questionHistory: {
    id: string;
    text: string;
    objectiveId: string;
    reason: string;
    kind?: string;
    phase?: string;
    repositoryReferences?: { path: string; startLine: number; endLine: number }[];
  }[];
}
