import type { ArchitectureRevisionDiff, ProblemConfig } from "@repo/voice-types";
import type { MemoryFact } from "./memory-facts.js";

export type InterviewDifficulty = "EASY" | "MEDIUM" | "HARD" | "EXPERT";
export type SystemDesignConcern =
  | "FLOW"
  | "BOTTLENECK"
  | "STATE"
  | "TRADEOFF"
  | "FAILURE"
  | "CLARIFICATION";
export type InterviewQuestionKind =
  | "OPENING"
  | "REPOSITORY"
  | "APPLIED_DESIGN";
export type GithubSegment = "OPENING" | "REPOSITORY" | "APPLIED_DESIGN";
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

export interface ObjectiveSource {
  path: string;
  note?: string;
}

export interface AppliedScenario {
  changedCondition: string;
  focus: string;
  detection: string;
  newTradeoff: string;
}

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
  kind?: InterviewQuestionKind;
  whyItMatters?: string;
  alternatives?: string[];
  uncertainties?: string[];
  sources?: ObjectiveSource[];
  scenario?: AppliedScenario;
}

export interface GithubInterviewState {
  segment: GithubSegment;
  budgetMinutes: number;
  mainQuestionsAsked: number;
  mainQuestionsTarget: number;
  followUpsAsked: number;
  appliedQuestionsAsked: number;
  maxMainQuestions: number;
  maxFollowUps: number;
  maxAppliedQuestions: number;
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
  kind?: InterviewQuestionKind;
  revision?: number;
  checkpoint?: boolean;
  concern?: SystemDesignConcern;
}

export interface AnswerAssessment {
  objectiveId: string;
  turnId: string;
  answeredQuestion: boolean;
  explainedResponsibilities: boolean;
  identifiedTradeoffOrFailure: boolean;
  consistentWithEvidence: boolean;
  objectiveSatisfied: boolean;
}

export type SystemDesignPhase =
  | "DESIGN_PENDING"
  | "DISCUSSION"
  | "CHECKPOINT"
  | "EDITING"
  | "FAILURE"
  | "FINAL_EDIT"
  | "FINISHED"
  | "REVISION_REQUESTED"
  | "REVISION_REVIEW";

export type SystemDesignCheckpointStatus =
  | "AWAITING_CHOICE"
  | "EDITING"
  | "SUBMITTED"
  | "RESOLVED";

export interface SystemDesignCheckpoint {
  id: string;
  questionId: string;
  questionRevision: number;
  status: SystemDesignCheckpointStatus;
  openedAt: string;
  resolvedAt?: string;
  choice?: "CONTINUE" | "EDIT";
  submittedRevision?: number;
  afterFailure: boolean;
}

export interface SystemDesignAnswerAssessment {
  questionId: string;
  turnId: string;
  revision: number;
  addressedQuestion: boolean;
  claimedGuaranteeOrTradeoff: string;
  unresolvedAssumption?: string;
  consistentWithDiagram: boolean;
  strength: "WEAK" | "MODERATE" | "STRONG";
  concern: SystemDesignConcern;
}

export interface SystemDesignInterviewState {
  problemId: string;
  problemSnapshot?: ProblemConfig;
  problemVersion: number;
  phase: SystemDesignPhase;
  activeRevision: number;
  activeSubmissionId?: string;
  questionsAsked: number;
  questionTarget: number;
  clarificationAsked: boolean;
  failureAsked: boolean;
  failureAnswerTurnId?: string;
  challengeIssued: boolean;
  revisionSubmitted: boolean;
  probesAsked: string[];
  selectedProbeIds: string[];
  checkpoint?: SystemDesignCheckpoint;
  checkpoints: SystemDesignCheckpoint[];
  answerAssessments: SystemDesignAnswerAssessment[];
  pendingQuestionId?: string;
  lastRevisionDiff?: ArchitectureRevisionDiff;
}

export interface InterviewState {
  memoryFacts?: MemoryFact[];
  mode?: "GITHUB" | "SYSTEM_DESIGN";
  github?: GithubInterviewState;
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
  lastAssessment?: AnswerAssessment;
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
  difficulty: "mid" | "senior";
  topics: string[];
  objectives: InterviewObjective[];
}
