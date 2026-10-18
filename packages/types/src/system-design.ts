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

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  brief: string;
  visibleRequirements: string[];
}

export interface ChallengeConfig {
  id: string;
  prompt: string;
  targetConcepts: string[];
}

export interface ProblemConfig extends ProblemSummary {
  version: 1;
  clarificationAnswers: Record<string, string>;
  evaluationGoals: string[];
  challenge: ChallengeConfig;
}

export type SystemDesignPhase =
  | "DESIGN_PENDING"
  | "DISCUSSION"
  | "REVISION_REQUESTED"
  | "REVISION_REVIEW"
  | "FINISHED";

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
}

export interface DesignView {
  interviewId: string;
  mode: "SYSTEM_DESIGN";
  problem: ProblemSummary | null;
  activeRevision: number;
  revisionAllowed: boolean;
  submission: {
    submissionId: string;
    revision: number;
    graphStatus: DesignGraphStatus;
    snapshot: ArchitectureSnapshot;
    createdAt: string;
  } | null;
}
