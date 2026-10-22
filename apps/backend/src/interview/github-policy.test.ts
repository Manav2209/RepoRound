import { describe, expect, test } from "bun:test";
import {
  createGithubState,
  recordGithubQuestion,
  selectGithubAction,
} from "./github-policy.js";
import { initialState, prepareGithubObjectives } from "./schemas.js";
import type {
  InterviewObjective,
  InterviewState,
  QuestionRecord,
} from "./interview.types.js";

function objective(
  id: string,
  kind: InterviewObjective["kind"],
  phase: InterviewObjective["phase"],
): InterviewObjective {
  return {
    id,
    kind,
    phase,
    topic: id,
    description: id,
    targetEvidence: [id],
    priority: "MEDIUM",
    status: "NOT_STARTED",
    evidenceIds: [],
    attempts: 0,
  };
}

function githubState(): InterviewState {
  const objectives = [
    objective("opening", "OPENING", "PROJECT_OVERVIEW"),
    objective("api", "REPOSITORY", "ARCHITECTURE"),
    objective("queue", "REPOSITORY", "IMPLEMENTATION"),
    objective("database", "REPOSITORY", "IMPLEMENTATION"),
    objective("debug", "REPOSITORY", "DEBUGGING"),
    objective("load", "APPLIED_DESIGN", "TRADEOFFS"),
    objective("outage", "APPLIED_DESIGN", "TRADEOFFS"),
  ];
  const state = initialState(objectives, "senior", {
    githubDurationMinutes: 15,
  });
  state.github = createGithubState(state.objectives, 15);
  return state;
}

function question(
  id: string,
  objectiveId: string,
  kind: QuestionRecord["kind"],
): QuestionRecord {
  return {
    id,
    text: id,
    objectiveId,
    phase: "PROJECT_OVERVIEW",
    difficulty: "HARD",
    reason: "NEW_TOPIC",
    askedAt: new Date().toISOString(),
    kind,
  };
}

describe("GitHub interview policy", () => {
  test("defaults to four main questions, two applied questions, and SD2-SD3", () => {
    const state = githubState();
    expect(state.mode).toBe("GITHUB");
    expect(state.difficulty).toBe("HARD");
    expect(state.github).toMatchObject({
      segment: "OPENING",
      budgetMinutes: 15,
      mainQuestionsAsked: 0,
      mainQuestionsTarget: 4,
      maxMainQuestions: 5,
      maxFollowUps: 3,
      appliedQuestionsAsked: 0,
      maxAppliedQuestions: 2,
    });
  });

  test("normalizes legacy plans and adds a missing opening", () => {
    const prepared = prepareGithubObjectives([
      objective("api", undefined, "ARCHITECTURE"),
      objective("load", "APPLIED_DESIGN", "IMPLEMENTATION"),
    ]);
    expect(prepared[0]).toMatchObject({
      kind: "OPENING",
      phase: "PROJECT_OVERVIEW",
      id: "obj_opening",
    });
    expect(prepared[1]).toMatchObject({
      id: "api",
      kind: "REPOSITORY",
    });
    expect(prepared[2]).toMatchObject({
      id: "load",
      kind: "APPLIED_DESIGN",
      phase: "TRADEOFFS",
    });
    expect(prepared[2]!.scenario).toBeDefined();
  });

  test("caps repository and applied intents and removes duplicate topics", () => {
    const prepared = prepareGithubObjectives([
      objective("opening", "OPENING", "PROJECT_OVERVIEW"),
      ...Array.from({ length: 6 }, (_, index) =>
        objective(`repo-${index}`, "REPOSITORY", "ARCHITECTURE"),
      ),
      { ...objective("duplicate", "REPOSITORY", "DEBUGGING"), topic: "repo-0" },
      ...Array.from({ length: 4 }, (_, index) =>
        objective(`applied-${index}`, "APPLIED_DESIGN", "TRADEOFFS"),
      ),
    ]);
    expect(
      prepared.filter((item) => item.kind === "REPOSITORY"),
    ).toHaveLength(4);
    expect(
      prepared.filter((item) => item.kind === "APPLIED_DESIGN"),
    ).toHaveLength(3);
    expect(
      prepared.filter((item) => item.topic === "repo-0"),
    ).toHaveLength(1);
  });

  test("asks opening, repository, applied, then ends without a new question", () => {
    const state = githubState();
    expect(selectGithubAction(state, 14)).toEqual({
      type: "ASK_NEW_TOPIC",
      objectiveId: "opening",
    });
    state.questions.push(question("q1", "opening", "OPENING"));
    recordGithubQuestion(state, state.objectives[0]!, false);
    expect(state.github?.segment).toBe("REPOSITORY");
    expect(selectGithubAction(state, 13)).toEqual({
      type: "ASK_NEW_TOPIC",
      objectiveId: "api",
    });
    state.github!.mainQuestionsAsked = 4;
    state.github!.appliedQuestionsAsked = 2;
    state.github!.segment = "APPLIED_DESIGN";
    expect(selectGithubAction(state, 1)).toEqual({ type: "END_INTERVIEW" });
  });

  test("one bounded clarification is allowed for a vague answer", () => {
    const state = githubState();
    state.questions.push(question("q1", "opening", "OPENING"));
    recordGithubQuestion(state, state.objectives[0]!, false);
    state.lastAssessment = {
      objectiveId: "opening",
      turnId: "t1",
      answeredQuestion: false,
      explainedResponsibilities: false,
      identifiedTradeoffOrFailure: false,
      consistentWithEvidence: true,
      objectiveSatisfied: false,
    };
    expect(selectGithubAction(state, 12)).toEqual({
      type: "ASK_CLARIFICATION",
      objectiveId: "opening",
    });
    state.questions.push({
      ...question("q2", "opening", "OPENING"),
      reason: "CLARIFICATION",
    });
    recordGithubQuestion(state, state.objectives[0]!, true);
    expect(state.github?.followUpsAsked).toBe(1);
    expect(selectGithubAction(state, 12)).toEqual({
      type: "ASK_NEW_TOPIC",
      objectiveId: "api",
    });
  });

  test("protects the applied block when less than five minutes remain", () => {
    const state = githubState();
    state.github!.mainQuestionsAsked = 4;
    state.github!.segment = "REPOSITORY";
    state.questions.push(
      question("q1", "opening", "OPENING"),
      question("q2", "api", "REPOSITORY"),
      question("q3", "queue", "REPOSITORY"),
      question("q4", "database", "REPOSITORY"),
    );
    for (const objective of state.objectives.slice(0, 4))
      objective.status = "SATISFIED";
    expect(selectGithubAction(state, 4)).toEqual({
      type: "ASK_NEW_TOPIC",
      objectiveId: "load",
    });
  });

  test("prefers the applied block over repairing a weak answer near the end", () => {
    const state = githubState();
    state.questions.push(
      question("q1", "opening", "OPENING"),
      question("q2", "api", "REPOSITORY"),
    );
    state.github!.mainQuestionsAsked = 2;
    state.lastAssessment = {
      objectiveId: "api",
      turnId: "t2",
      answeredQuestion: false,
      explainedResponsibilities: false,
      identifiedTradeoffOrFailure: false,
      consistentWithEvidence: true,
      objectiveSatisfied: false,
    };
    expect(selectGithubAction(state, 4)).toEqual({
      type: "ASK_NEW_TOPIC",
      objectiveId: "load",
    });
  });

  test("only asks a fifth main question when enough time remains", () => {
    const state = githubState();
    state.github!.mainQuestionsAsked = 4;
    state.github!.segment = "REPOSITORY";
    state.questions.push(
      question("q1", "opening", "OPENING"),
      question("q2", "api", "REPOSITORY"),
      question("q3", "queue", "REPOSITORY"),
      question("q4", "database", "REPOSITORY"),
    );
    for (const objective of state.objectives.slice(0, 4))
      objective.status = "SATISFIED";
    expect(selectGithubAction(state, 8)).toEqual({
      type: "ASK_NEW_TOPIC",
      objectiveId: "debug",
    });
    expect(selectGithubAction(state, 6)).toEqual({
      type: "ASK_NEW_TOPIC",
      objectiveId: "load",
    });
  });

  test("does not treat a missing assessment as a vague answer", () => {
    const state = githubState();
    state.questions.push(question("q1", "opening", "OPENING"));
    recordGithubQuestion(state, state.objectives[0]!, false);
    expect(selectGithubAction(state, 12)).toEqual({
      type: "ASK_NEW_TOPIC",
      objectiveId: "api",
    });
  });
});
