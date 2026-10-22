import { z } from "zod";
import type { InterviewObjective, InterviewState } from "./interview.types.js";

export const questionKindSchema = z.enum([
  "OPENING",
  "REPOSITORY",
  "APPLIED_DESIGN",
]);
export const githubSegmentSchema = z.enum([
  "OPENING",
  "REPOSITORY",
  "APPLIED_DESIGN",
]);
export const objectiveSourceSchema = z.object({
  path: z.string().min(1).max(500),
  note: z.string().max(300).optional(),
});
export const appliedScenarioSchema = z.object({
  changedCondition: z.string().min(1).max(300),
  focus: z.string().min(1).max(300),
  detection: z.string().min(1).max(300),
  newTradeoff: z.string().min(1).max(300),
});
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
  kind: questionKindSchema.default("REPOSITORY"),
  whyItMatters: z.string().max(500).default(""),
  alternatives: z.array(z.string().max(200)).max(4).default([]),
  uncertainties: z.array(z.string().max(300)).max(5).default([]),
  sources: z.array(objectiveSourceSchema).max(5).default([]),
  scenario: appliedScenarioSchema.optional(),
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
  kind: questionKindSchema.optional(),
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

export const githubStateSchema = z.object({
  segment: githubSegmentSchema.default("OPENING"),
  budgetMinutes: z.number().min(1).max(60).default(15),
  mainQuestionsAsked: z.number().int().nonnegative().default(0),
  mainQuestionsTarget: z.number().int().min(1).max(5).default(4),
  followUpsAsked: z.number().int().nonnegative().default(0),
  appliedQuestionsAsked: z.number().int().nonnegative().default(0),
  maxMainQuestions: z.number().int().min(1).max(5).default(5),
  maxFollowUps: z.number().int().min(0).max(3).default(3),
  maxAppliedQuestions: z.number().int().min(0).max(3).default(3),
});
export type GithubState = z.infer<typeof githubStateSchema>;

export const answerAssessmentSchema = z.object({
  objectiveId: z.string(),
  turnId: z.string(),
  answeredQuestion: z.boolean(),
  explainedResponsibilities: z.boolean(),
  identifiedTradeoffOrFailure: z.boolean(),
  consistentWithEvidence: z.boolean(),
  objectiveSatisfied: z.boolean(),
});

export const stateSchema = z.object({
  mode: z.enum(["GITHUB", "SYSTEM_DESIGN"]).optional(),
  github: githubStateSchema.optional(),
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
  lastAssessment: answerAssessmentSchema.optional(),
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
  answeredQuestion: z.boolean(),
  explainedResponsibilities: z.boolean(),
  identifiedTradeoffOrFailure: z.boolean(),
  consistentWithEvidence: z.boolean(),
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

const GITHUB_PHASE_ORDER = [
  "PROJECT_OVERVIEW",
  "ARCHITECTURE",
  "IMPLEMENTATION",
  "DEBUGGING",
  "TRADEOFFS",
] as const;
const PRIORITY_ORDER = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

function defaultOpeningObjective(): InterviewObjective {
  return {
    id: "obj_opening",
    phase: "PROJECT_OVERVIEW",
    topic: "Project purpose and ownership",
    description:
      "What the project does, who it serves, and which decisions the candidate personally made",
    targetEvidence: [
      "explains the project purpose and its users",
      "identifies their personal contribution and decisions",
    ],
    priority: "HIGH",
    status: "NOT_STARTED",
    evidenceIds: [],
    attempts: 0,
    kind: "OPENING",
    whyItMatters:
      "Separates repository facts from the candidate's claimed ownership.",
    alternatives: [],
    uncertainties: [],
    sources: [],
  };
}

function defaultScenario(objective: InterviewObjective) {
  return {
    changedCondition:
      "the same architecture must handle ten times the current traffic and project count",
    focus: objective.topic,
    detection: "what signal would show the first bottleneck",
    newTradeoff: "what they would change and what tradeoff that introduces",
  };
}

export function prepareGithubObjectives(objectives: unknown): InterviewObjective[] {
  const parsed = objectiveSchema
    .array()
    .min(1)
    .max(20)
    .parse(objectives)
    .map((o) => ({ ...o }));
  const seen = new Set<string>();
  const deduped = parsed.filter((o) => {
    const key = o.topic.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const opening =
    deduped.find((o) => o.kind === "OPENING") ??
    deduped.find((o) => o.phase === "PROJECT_OVERVIEW") ??
    defaultOpeningObjective();
  const repository = deduped
    .filter(
      (o) =>
        o !== opening && o.kind !== "APPLIED_DESIGN" && o.kind !== "OPENING",
    )
    .sort(
      (a, b) =>
        GITHUB_PHASE_ORDER.indexOf(a.phase) -
          GITHUB_PHASE_ORDER.indexOf(b.phase) ||
        PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority],
    )
    .slice(0, 4);
  const applied = deduped
    .filter((o) => o.kind === "APPLIED_DESIGN")
    .slice(0, 3)
    .map((o) => ({
      ...o,
      phase: "TRADEOFFS" as const,
      scenario: o.scenario ?? defaultScenario(o),
    }));
  return [
    { ...opening, kind: "OPENING" as const, phase: "PROJECT_OVERVIEW" as const },
    ...repository,
    ...applied,
  ];
}

export function initialState(
  objectives: unknown,
  difficulty: string,
  options: { githubDurationMinutes?: number } = {},
): InterviewState {
  const prepared = prepareGithubObjectives(objectives);
  const mainCount = prepared.filter(
    (o) => o.kind === "OPENING" || o.kind === "REPOSITORY",
  ).length;
  const appliedCount = prepared.filter(
    (o) => o.kind === "APPLIED_DESIGN",
  ).length;
  return {
    mode: "GITHUB",
    github: {
      segment: "OPENING",
      budgetMinutes: options.githubDurationMinutes ?? 15,
      mainQuestionsAsked: 0,
      mainQuestionsTarget: Math.max(1, Math.min(4, mainCount)),
      followUpsAsked: 0,
      appliedQuestionsAsked: 0,
      maxMainQuestions: Math.max(1, Math.min(5, mainCount)),
      maxFollowUps: 3,
      maxAppliedQuestions: Math.min(3, appliedCount),
    },
    phase: "INTRO",
    difficulty: difficulty === "senior" ? "HARD" : "MEDIUM",
    objectives: prepared,
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
