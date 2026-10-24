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

export const COMPONENT_KINDS: readonly ComponentKind[] = [
  "client",
  "load_balancer",
  "api_service",
  "database",
  "cache",
  "message_queue",
  "worker",
  "object_storage",
  "external_service",
  "cdn",
];

export type DesignGraphStatus = "BUILDING" | "READY" | "FAILED";

export interface ArchitectureNode {
  id: string;
  position: { x: number; y: number };
  data: { componentType: ComponentKind; label: string };
}

export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
}

export interface ArchitectureSnapshot {
  schemaVersion: 1;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

export interface SubmitArchitectureRequest {
  requestId: string;
  expectedRevision: number;
  snapshot: ArchitectureSnapshot;
}

export interface ArchitectureNodeRef {
  id: string;
  label: string;
  componentType: ComponentKind;
}

export interface ArchitectureEdgeRef {
  source: string;
  target: string;
}

export interface ArchitectureRevisionDiff {
  fromRevision: number;
  toRevision: number;
  nodes: {
    added: ArchitectureNodeRef[];
    removed: ArchitectureNodeRef[];
    relabeled: { id: string; before: string; after: string }[];
    retyped: {
      id: string;
      before: ComponentKind;
      after: ComponentKind;
    }[];
  };
  edges: {
    added: ArchitectureEdgeRef[];
    removed: ArchitectureEdgeRef[];
    reconnected: {
      edgeId: string;
      before: ArchitectureEdgeRef;
      after: ArchitectureEdgeRef;
    }[];
  };
  material: boolean;
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

export interface ChallengeConfig {
  id: string;
  prompt: string;
  targetConcepts: string[];
}

export interface ProblemConfig extends ProblemSummary {
  clarificationAnswers: Record<string, string>;
  evaluationGoals: string[];
  challenge: ChallengeConfig;
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

export interface SystemDesignCheckpointView {
  id: string;
  questionId: string;
  questionRevision: number;
  status: SystemDesignCheckpointStatus;
  choice?: "CONTINUE" | "EDIT";
  submittedRevision?: number;
  afterFailure: boolean;
}

export interface GraphReference {
  componentIds: string[];
  path: string[];
}

export interface SelectedProbe {
  probeId: string;
  submissionId: string;
  revision: number;
  referencedComponentIds: string[];
  graphPath: string[];
  reason: string;
}

export interface DesignSubmissionResponse {
  submissionId: string;
  revision: number;
  graphStatus: DesignGraphStatus;
  next: "START_INTERVIEW" | "RESUME_INTERVIEW";
  noChange?: boolean;
}

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
  checkpoint: SystemDesignCheckpointView | null;
  submission: {
    submissionId: string;
    revision: number;
    graphStatus: DesignGraphStatus;
    snapshot: ArchitectureSnapshot;
    createdAt: string;
  } | null;
}
