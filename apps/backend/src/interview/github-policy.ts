import type {
  GithubInterviewState,
  InterviewObjective,
  InterviewQuestionKind,
  InterviewState,
  NextInterviewAction,
  QuestionRecord,
} from "./interview.types.js";

export const GITHUB_BUDGET = {
  defaultMainQuestions: 4,
  maxMainQuestions: 5,
  maxFollowUps: 3,
  maxAppliedQuestions: 3,
  appliedBlockLeadMinutes: 5,
  minMinutesForNewQuestion: 1,
  minMinutesForFifthMain: 7,
  minMinutesForThirdApplied: 4,
  minMinutesForSecondApplied: 2,
} as const;

const PHASE_ORDER = [
  "PROJECT_OVERVIEW",
  "ARCHITECTURE",
  "IMPLEMENTATION",
  "DEBUGGING",
  "TRADEOFFS",
] as const;
const PRIORITY_ORDER = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

export function objectiveKind(
  objective: InterviewObjective,
): InterviewQuestionKind {
  return (
    objective.kind ??
    (objective.phase === "PROJECT_OVERVIEW" ? "OPENING" : "REPOSITORY")
  );
}

function isPending(objective: InterviewObjective): boolean {
  return !["SATISFIED", "INSUFFICIENT"].includes(objective.status);
}

function maxLimits(objectives: InterviewObjective[]) {
  const mainCount = objectives.filter(
    (o) => objectiveKind(o) === "OPENING" || objectiveKind(o) === "REPOSITORY",
  ).length;
  const appliedCount = objectives.filter(
    (o) => objectiveKind(o) === "APPLIED_DESIGN",
  ).length;
  return {
    maxMainQuestions: Math.max(
      1,
      Math.min(GITHUB_BUDGET.maxMainQuestions, mainCount),
    ),
    mainQuestionsTarget: Math.max(
      1,
      Math.min(GITHUB_BUDGET.defaultMainQuestions, mainCount),
    ),
    maxAppliedQuestions: Math.min(
      GITHUB_BUDGET.maxAppliedQuestions,
      appliedCount,
    ),
  };
}

export function createGithubState(
  objectives: InterviewObjective[],
  budgetMinutes = 15,
): GithubInterviewState {
  const limits = maxLimits(objectives);
  return {
    segment: "OPENING",
    budgetMinutes,
    mainQuestionsAsked: 0,
    mainQuestionsTarget: limits.mainQuestionsTarget,
    followUpsAsked: 0,
    appliedQuestionsAsked: 0,
    maxMainQuestions: limits.maxMainQuestions,
    maxFollowUps: GITHUB_BUDGET.maxFollowUps,
    maxAppliedQuestions: limits.maxAppliedQuestions,
  };
}

export function ensureGithubState(
  state: InterviewState,
  budgetMinutes = 15,
): GithubInterviewState {
  if (!state.objectives.some((o) => o.kind === "OPENING")) {
    const first =
      state.objectives.find((o) => o.phase === "PROJECT_OVERVIEW") ??
      state.objectives[0];
    if (first) first.kind = "OPENING";
  }
  for (const objective of state.objectives)
    objective.kind ??= "REPOSITORY";
  if (state.github) return state.github;
  const byId = new Map(
    state.objectives.map((objective) => [objective.id, objective]),
  );
  const askedObjectiveIds = new Set(
    state.questions.map((question) => question.objectiveId),
  );
  const asked = [...askedObjectiveIds]
    .map((id) => byId.get(id))
    .filter((objective): objective is InterviewObjective => !!objective);
  const appliedQuestionsAsked = asked.filter(
    (objective) => objectiveKind(objective) === "APPLIED_DESIGN",
  ).length;
  const mainQuestionsAsked = asked.length - appliedQuestionsAsked;
  const limits = maxLimits(state.objectives);
  state.github = {
    segment:
      appliedQuestionsAsked > 0
        ? "APPLIED_DESIGN"
        : mainQuestionsAsked > 0
          ? "REPOSITORY"
          : "OPENING",
    budgetMinutes,
    mainQuestionsAsked,
    mainQuestionsTarget: limits.mainQuestionsTarget,
    followUpsAsked: Math.max(
      0,
      state.questions.length - askedObjectiveIds.size,
    ),
    appliedQuestionsAsked,
    maxMainQuestions: limits.maxMainQuestions,
    maxFollowUps: GITHUB_BUDGET.maxFollowUps,
    maxAppliedQuestions: limits.maxAppliedQuestions,
  };
  return state.github;
}

export function recordGithubQuestion(
  state: InterviewState,
  objective: InterviewObjective,
  isFollowUp: boolean,
): void {
  const github = ensureGithubState(state);
  if (isFollowUp) {
    github.followUpsAsked++;
    return;
  }
  if (objectiveKind(objective) === "APPLIED_DESIGN") {
    github.appliedQuestionsAsked++;
    github.segment = "APPLIED_DESIGN";
    return;
  }
  github.mainQuestionsAsked++;
  if (objectiveKind(objective) === "OPENING") github.segment = "REPOSITORY";
  if (github.segment === "OPENING") github.segment = "REPOSITORY";
}

function nextObjective(
  state: InterviewState,
  kind: InterviewQuestionKind,
): InterviewObjective | undefined {
  const byId = new Map(
    state.objectives.map((objective) => [objective.id, objective]),
  );
  const askedObjectiveIds = new Set(
    state.questions.map((question) => question.objectiveId),
  );
  const askedTopics = new Set(
    [...askedObjectiveIds]
      .map((id) => byId.get(id)?.topic.trim().toLowerCase())
      .filter((topic): topic is string => !!topic),
  );
  return state.objectives
    .filter(
      (objective) =>
        objectiveKind(objective) === kind &&
        isPending(objective) &&
        !askedObjectiveIds.has(objective.id) &&
        !askedTopics.has(objective.topic.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) ||
        PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority],
    )[0];
}

function maybeFollowUp(
  state: InterviewState,
  github: GithubInterviewState,
  current: QuestionRecord | undefined,
  currentObjective: InterviewObjective | undefined,
  failedAnalysis: boolean,
): NextInterviewAction | null {
  if (
    !current ||
    !currentObjective ||
    !isPending(currentObjective) ||
    github.followUpsAsked >= github.maxFollowUps
  )
    return null;
  const askedForObjective = state.questions.filter(
    (question) => question.objectiveId === currentObjective.id,
  ).length;
  if (askedForObjective >= 2) return null;
  const topic = currentObjective.topic.toLowerCase();
  const contradicted = [...state.claims]
    .reverse()
    .find(
      (claim) =>
        !claim.probed &&
        claim.status === "CONTRADICTED" &&
        claim.topic.trim().toLowerCase() === topic,
    );
  if (contradicted)
    return {
      type: "CHALLENGE_DECISION",
      objectiveId: currentObjective.id,
      claimId: contradicted.id,
    };
  const assessment =
    state.lastAssessment?.objectiveId === currentObjective.id
      ? state.lastAssessment
      : undefined;
  const latestEvidence = state.evidence
    .filter((evidence) => evidence.objectiveId === currentObjective.id)
    .at(-1);
  const vague =
    failedAnalysis ||
    (!!assessment &&
      (!assessment.answeredQuestion ||
        (!assessment.explainedResponsibilities &&
          !assessment.identifiedTradeoffOrFailure)));
  const inconsistent =
    !!assessment && !assessment.consistentWithEvidence;
  const weak = latestEvidence?.strength === "WEAK";
  return vague || inconsistent || weak
    ? { type: "ASK_CLARIFICATION", objectiveId: currentObjective.id }
    : null;
}

function selectApplied(
  state: InterviewState,
  github: GithubInterviewState,
  remainingMinutes: number,
): NextInterviewAction {
  if (
    remainingMinutes <= GITHUB_BUDGET.minMinutesForNewQuestion ||
    github.appliedQuestionsAsked >= github.maxAppliedQuestions
  )
    return { type: "END_INTERVIEW" };
  if (
    github.appliedQuestionsAsked >= 1 &&
    remainingMinutes <= GITHUB_BUDGET.minMinutesForSecondApplied
  )
    return { type: "END_INTERVIEW" };
  if (
    github.appliedQuestionsAsked >= 2 &&
    remainingMinutes <= GITHUB_BUDGET.minMinutesForThirdApplied
  )
    return { type: "END_INTERVIEW" };
  const objective = nextObjective(state, "APPLIED_DESIGN");
  return objective
    ? { type: "ASK_NEW_TOPIC", objectiveId: objective.id }
    : { type: "END_INTERVIEW" };
}

export function selectGithubAction(
  state: InterviewState,
  remainingMinutes: number,
  failedAnalysis = false,
): NextInterviewAction {
  if (
    state.ended ||
    state.phase === "COMPLETED" ||
    remainingMinutes <= GITHUB_BUDGET.minMinutesForNewQuestion
  )
    return { type: "END_INTERVIEW" };
  const github = ensureGithubState(state);
  const byId = new Map(
    state.objectives.map((objective) => [objective.id, objective]),
  );
  const current = state.questions.at(-1);
  const currentObjective = current ? byId.get(current.objectiveId) : undefined;
  const followUp = maybeFollowUp(
    state,
    github,
    current,
    currentObjective,
    failedAnalysis,
  );
  if (followUp) {
    const protectApplied =
      remainingMinutes <= GITHUB_BUDGET.appliedBlockLeadMinutes &&
      (!currentObjective ||
        objectiveKind(currentObjective) !== "APPLIED_DESIGN") &&
      !!nextObjective(state, "APPLIED_DESIGN");
    if (!protectApplied) return followUp;
  }
  const totalLimit =
    github.maxMainQuestions +
    github.maxFollowUps +
    github.maxAppliedQuestions;
  if (state.questions.length >= totalLimit)
    return { type: "END_INTERVIEW" };

  const opening = nextObjective(state, "OPENING");
  if (opening && github.mainQuestionsAsked === 0)
    return { type: "ASK_NEW_TOPIC", objectiveId: opening.id };
  if (github.segment === "OPENING") github.segment = "REPOSITORY";

  if (github.segment === "APPLIED_DESIGN")
    return selectApplied(state, github, remainingMinutes);

  const repository = nextObjective(state, "REPOSITORY");
  const applied = nextObjective(state, "APPLIED_DESIGN");
  const mainTarget = Math.min(
    GITHUB_BUDGET.defaultMainQuestions,
    github.maxMainQuestions,
  );
  const fifthAllowed =
    github.mainQuestionsAsked >= mainTarget &&
    github.mainQuestionsAsked < github.maxMainQuestions &&
    remainingMinutes > GITHUB_BUDGET.minMinutesForFifthMain;
  const lowTime = remainingMinutes <= GITHUB_BUDGET.appliedBlockLeadMinutes;
  const canAskRepository =
    !!repository && !lowTime && (github.mainQuestionsAsked < mainTarget || fifthAllowed);
  if (canAskRepository)
    return { type: "ASK_NEW_TOPIC", objectiveId: repository.id };
  if (applied) {
    github.segment = "APPLIED_DESIGN";
    return selectApplied(state, github, remainingMinutes);
  }
  return repository
    ? { type: "ASK_NEW_TOPIC", objectiveId: repository.id }
    : { type: "END_INTERVIEW" };
}
