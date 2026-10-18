import { z } from "zod";
import type { InterviewState } from "./interview.types.js";

export const phaseSchema = z.enum([
  "INTRO",
  "PROJECT_OVERVIEW",
  "ARCHITECTURE",
  "IMPLEMENTATION",
  "DEBUGGING",
  "TRADEOFFS",
  "FINAL",
  "COMPLETED",
]);
export const difficultySchema = z.enum(["EASY", "MEDIUM", "HARD", "EXPERT"]);
export const referenceSchema = z.object({
  path: z.string().max(500),
  commitSha: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export const objectiveSchema = z.object({
  id: z.string(),
  phase: z.enum([
    "PROJECT_OVERVIEW",
    "ARCHITECTURE",
    "IMPLEMENTATION",
    "DEBUGGING",
    "TRADEOFFS",
  ]),
  topic: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  targetEvidence: z.array(z.string().max(300)).min(1).max(8),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "SATISFIED", "INSUFFICIENT"]),
  evidenceIds: z.array(z.string()),
  attempts: z.number().int().nonnegative(),
});
export const evidenceSchema = z.object({
  id: z.string(),
  objectiveId: z.string(),
  skill: z.string().max(100),
  topic: z.string().max(100),
  evidence: z.string().max(1500),
  strength: z.enum(["WEAK", "MODERATE", "STRONG"]),
  sourceTurnId: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  repositoryReferences: z.array(referenceSchema).optional(),
});
export const claimSchema = z.object({
  id: z.string(),
  statement: z.string().max(1500),
  topic: z.string().max(100),
  sourceTurnId: z.string(),
  status: z.enum(["UNVERIFIED", "SUPPORTED", "CONTRADICTED", "NOT_VERIFIABLE"]),
  confidence: z.number().min(0).max(1).optional(),
  repositoryEvidence: z.array(referenceSchema).optional(),
  probed: z.boolean().optional(),
});
export const questionRecordSchema = z.object({
  id: z.string(),
  text: z.string().max(500),
  objectiveId: z.string(),
  phase: phaseSchema,
  difficulty: difficultySchema,
  reason: z.enum([
    "NEW_TOPIC",
    "PROBE",
    "CLARIFICATION",
    "CHALLENGE",
    "DEBUGGING",
    "TRADEOFF",
  ]),
  sourceTurnId: z.string().optional(),
  askedAt: z.string(),
  answerTurnId: z.string().optional(),
  spokenAt: z.string().optional(),
  repositoryReferences: z.array(referenceSchema).optional(),
});
export const systemDesignPhaseSchema = z.enum([
  "DESIGN_PENDING",
  "DISCUSSION",
  "REVISION_REQUESTED",
  "REVISION_REVIEW",
  "FINISHED",
]);
export const systemDesignStateSchema = z.object({
  problemId: z.string().min(1).max(100),
  phase: systemDesignPhaseSchema.default("DISCUSSION"),
  activeRevision: z.number().int().nonnegative().default(0),
  activeSubmissionId: z.string().max(100).optional(),
  challengeIssued: z.boolean().default(false),
  revisionSubmitted: z.boolean().default(false),
  probesAsked: z.array(z.string()).default([]),
  selectedProbeIds: z.array(z.string()).default([]),
});
export type SystemDesignState = z.infer<typeof systemDesignStateSchema>;

export const stateSchema = z.object({
  mode: z.enum(["GITHUB", "SYSTEM_DESIGN"]).optional(),
  systemDesign: systemDesignStateSchema.optional(),
  phase: phaseSchema,
  difficulty: difficultySchema,
  objectives: z.array(objectiveSchema).max(20),
  claims: z.array(claimSchema),
  evidence: z.array(evidenceSchema),
  questions: z.array(questionRecordSchema),
  processedTurns: z.record(z.string()),
  ended: z.boolean(),
  skills: z
    .record(
      z.object({
        skill: z.string(),
        evidenceIds: z.array(z.string()),
        confidence: z.number().min(0).max(1),
        depth: z.enum(["UNKNOWN", "BASIC", "INTERMEDIATE", "ADVANCED"]),
        needsMoreEvidence: z.boolean(),
      }),
    )
    .default({}),
  exploredTopics: z.array(z.string()).default([]),
  endReason: z.string().optional(),
  toolCalls: z.number().int().nonnegative().default(0),
});
export const answerAnalysisSchema = z.object({
  summary: z.string().max(1500).default(""),
  claims: z
    .array(
      z.object({
        statement: z.string().min(1).max(1500),
        topic: z.string().min(1).max(100),
        confidence: z.number().min(0).max(1).default(0.5),
      }),
    )
    .max(5),
  evidence: z
    .array(
      z.object({
        skill: z.string().min(1).max(100),
        topic: z.string().min(1).max(100),
        evidence: z.string().min(1).max(1500),
        strength: z.enum(["WEAK", "MODERATE", "STRONG"]),
        confidence: z.number().min(0).max(1).default(0.5),
      }),
    )
    .max(5),
  objectiveSatisfied: z.boolean(),
  uncertainty: z.array(z.string().max(300)).max(5).default([]),
  suggestedFollowUps: z.array(z.string().max(300)).max(3).default([]),
  toolRequests: z
    .array(
      z.object({
        name: z.enum([
          "get_project_context",
          "get_architecture",
          "get_file",
          "get_symbol",
          "search_code",
          "get_dependency",
        ]),
        args: z.record(z.unknown()),
      }),
    )
    .max(2)
    .default([]),
});

export function initialState(
  objectives: unknown,
  difficulty: string,
): InterviewState {
  return {
    phase: "INTRO",
    difficulty:
      difficulty === "junior"
        ? "EASY"
        : difficulty === "senior"
          ? "HARD"
          : "MEDIUM",
    objectives: objectiveSchema
      .array()
      .min(1)
      .max(20)
      .parse(objectives)
      .map((o) => ({
        ...o,
        status: "NOT_STARTED",
        evidenceIds: [],
        attempts: 0,
      })),
    claims: [],
    evidence: [],
    questions: [],
    processedTurns: {},
    ended: false,
    skills: {},
    exploredTopics: [],
    toolCalls: 0,
  };
}

export function initialSystemDesignState(input: {
  problemId: string;
  activeRevision: number;
  activeSubmissionId: string;
  objectives: unknown;
  difficulty?: string;
}): InterviewState {
  return {
    mode: "SYSTEM_DESIGN",
    systemDesign: {
      problemId: input.problemId,
      phase: "DISCUSSION",
      activeRevision: input.activeRevision,
      activeSubmissionId: input.activeSubmissionId,
      challengeIssued: false,
      revisionSubmitted: false,
      probesAsked: [],
      selectedProbeIds: [],
    },
    phase: "ARCHITECTURE",
    difficulty:
      input.difficulty === "EASY"
        ? "EASY"
        : input.difficulty === "MEDIUM"
          ? "MEDIUM"
          : "HARD",
    objectives: objectiveSchema
      .array()
      .max(20)
      .parse(input.objectives)
      .map((o) => ({
        ...o,
        status: "NOT_STARTED",
        evidenceIds: [],
        attempts: 0,
      })),
    claims: [],
    evidence: [],
    questions: [],
    processedTurns: {},
    ended: false,
    skills: {},
    exploredTopics: [],
    toolCalls: 0,
  };
}
