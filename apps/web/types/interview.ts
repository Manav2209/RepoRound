export type InterviewStatus =
  | "preparing"
  | "created"
  | "analyzing"
  | "ready"
  | "connecting"
  | "active"
  | "ending"
  | "completing"
  | "evaluation_failed"
  | "completed"
  | "failed";

export type ConnectionStatus =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  final: boolean;
}

export interface SessionInfo {
  interviewId: string;
  sessionId: string;
  roomName: string;
  serverUrl: string;
  token: string;
}

export interface InterviewResult {
  coverage?: {
    totalTurns: number;
    includedTurns: number;
    omittedTurns: number;
    truncatedTurns: number;
    quality: "complete" | "partial";
  };
  status: string;
  score: number | null;
  dimensions: Record<string, number | null>;
  strengths: string[];
  weaknesses: string[];
  feedback: string;
  evidence?: Record<
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
  message?: string;
  summary?: {
    repository: string;
    candidateTurns: number;
    answeredQuestions: number;
    analyzedTurns: number;
    failedAnalyses: number;
    durationSeconds: number | null;
  };
}

export type InterviewMode = "GITHUB" | "SYSTEM_DESIGN";

export interface ReportListItem {
  interviewId: string;
  mode: InterviewMode;
  title: string;
  score: number | null;
  completedAt: string | null;
}

export interface InterviewView {
  interviewId: string;
  status: InterviewStatus;
  mode?: InterviewMode;
  githubUrl?: string;
  problemId?: string;
  error?: string;
  preparationStage?: "analyzing" | "planning" | "ready" | "designing";
}

export type ComponentKind =
  | "client"
  | "load_balancer"
  | "api_service"
  | "database"
  | "cache"
  | "message_queue"
  | "worker"
  | "object_storage"
  | "external_service"
  | "cdn";

export interface ArchitectureSnapshot {
  schemaVersion: 1;
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: { componentType: ComponentKind; label: string };
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export interface ProblemSummary {
  id: string;
  version: number;
  title: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  brief: string;
  visibleRequirements: string[];
  loadAssumption: string;
  constraints: string[];
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

export interface DesignView {
  interviewId: string;
  mode: "SYSTEM_DESIGN";
  status: string;
  problem: ProblemSummary | null;
  activeRevision: number;
  revisionAllowed: boolean;
  phase: SystemDesignPhase | null;
  deadlineAt: string | null;
  remainingSeconds: number;
  questionCount: number;
  questionTarget: number;
  checkpoint: {
    id: string;
    questionId: string;
    questionRevision: number;
    status: SystemDesignCheckpointStatus;
    choice?: "CONTINUE" | "EDIT";
    submittedRevision?: number;
    afterFailure: boolean;
  } | null;
  submission: {
    submissionId: string;
    revision: number;
    graphStatus: "BUILDING" | "READY" | "FAILED";
    snapshot: ArchitectureSnapshot;
    createdAt: string;
  } | null;
}

export interface DesignSubmissionResult {
  submissionId: string;
  revision: number;
  graphStatus: "BUILDING" | "READY" | "FAILED";
  next: "START_INTERVIEW" | "RESUME_INTERVIEW";
  noChange: boolean;
}
