export interface EvaluationDimensions {
  technicalKnowledge: number | null;
  problemSolving: number | null;
  communication: number | null;
  projectUnderstanding: number | null;
  depth: number | null;
}

export interface Evaluation {
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
    }[];
  };
  transcript: {
    id: string;
    role: "user" | "assistant";
    text: string;
    questionId?: string | null;
  }[];
  systemDesign?: {
    problemTitle: string;
    brief: string;
    requirements: string[];
    challenge: string;
    probesAsked: string[];
    challengeIssued: boolean;
    revisionSubmitted: boolean;
    revision1: { nodes: number; edges: number; components: string[] };
    revision2?: { nodes: number; edges: number; components: string[] };
  };
  candidateEvidence: import("../interview/interview.types.js").CandidateEvidence[];
  claims?: import("../interview/interview.types.js").CandidateClaim[];
  skills?: Record<string, import("../interview/interview.types.js").SkillState>;
  questionHistory: {
    id: string;
    text: string;
    objectiveId: string;
    reason: string;
  }[];
}
