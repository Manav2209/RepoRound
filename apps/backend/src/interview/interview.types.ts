export type InterviewDifficulty = "EASY" | "MEDIUM" | "HARD" | "EXPERT";
export type InterviewPhase =
  | "INTRO"
  | "PROJECT_OVERVIEW"
  | "ARCHITECTURE"
  | "IMPLEMENTATION"
  | "DEBUGGING"
  | "TRADEOFFS"
  | "FINAL"
  | "COMPLETED";
export type ObjectiveStatus =
  "NOT_STARTED" | "IN_PROGRESS" | "SATISFIED" | "INSUFFICIENT";

export interface InterviewObjective {
  id: string;
  phase: Exclude<InterviewPhase, "INTRO" | "FINAL" | "COMPLETED">;
  topic: string;
  description: string;
  targetEvidence: string[];
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: ObjectiveStatus;
  evidenceIds: string[];
  attempts: number;
}

export interface CandidateEvidence {
  id: string;
  objectiveId: string;
  skill: string;
  topic: string;
  evidence: string;
  strength: "WEAK" | "MODERATE" | "STRONG";
  sourceTurnId: string;
  confidence?: number;
  repositoryReferences?: RepositoryReference[];
}

export interface CandidateClaim {
  id: string;
  statement: string;
  topic: string;
  sourceTurnId: string;
  status: "UNVERIFIED" | "SUPPORTED" | "CONTRADICTED" | "NOT_VERIFIABLE";
  confidence?: number;
  repositoryEvidence?: RepositoryReference[];
  probed?: boolean;
}

export interface RepositoryReference {
  path: string;
  commitSha: string;
  startLine: number;
  endLine: number;
}

export interface SkillState {
  skill: string;
  evidenceIds: string[];
  confidence: number;
  depth: "UNKNOWN" | "BASIC" | "INTERMEDIATE" | "ADVANCED";
  needsMoreEvidence: boolean;
}

export interface QuestionRecord {
  id: string;
  text: string;
  objectiveId: string;
  phase: InterviewPhase;
  difficulty: InterviewDifficulty;
  reason:
    | "NEW_TOPIC"
    | "PROBE"
    | "CLARIFICATION"
    | "CHALLENGE"
    | "DEBUGGING"
    | "TRADEOFF";
  sourceTurnId?: string;
  askedAt: string;
  answerTurnId?: string;
  repositoryReferences?: RepositoryReference[];
  spokenAt?: string;
}

export type SystemDesignPhase =
  | "DESIGN_PENDING"
  | "DISCUSSION"
  | "REVISION_REQUESTED"
  | "REVISION_REVIEW"
  | "FINISHED";

export interface SystemDesignInterviewState {
  problemId: string;
  phase: SystemDesignPhase;
  activeRevision: number;
  activeSubmissionId?: string;
  challengeIssued: boolean;
  revisionSubmitted: boolean;
  probesAsked: string[];
  selectedProbeIds: string[];
}

export interface InterviewState {
  mode?: "GITHUB" | "SYSTEM_DESIGN";
  systemDesign?: SystemDesignInterviewState;
  phase: InterviewPhase;
  difficulty: InterviewDifficulty;
  objectives: InterviewObjective[];
  claims: CandidateClaim[];
  evidence: CandidateEvidence[];
  questions: QuestionRecord[];
  processedTurns: Record<string, string>;
  ended: boolean;
  skills?: Record<string, SkillState>;
  exploredTopics?: string[];
  endReason?: string;
  toolCalls?: number;
}

export type NextInterviewAction =
  | {
      type:
        | "ASK_NEW_TOPIC"
        | "ASK_DEBUGGING"
        | "CHALLENGE_DECISION"
        | "ASK_CLARIFICATION"
        | "PROBE_CLAIM";
      objectiveId: string;
      claimId?: string;
    }
  | { type: "END_INTERVIEW" };

export interface InterviewPlan {
  role: string;
  difficulty: "junior" | "mid" | "senior";
  topics: string[];
  objectives: InterviewObjective[];
}
