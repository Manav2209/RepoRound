import { describe, expect, test } from "bun:test";
import { initialSystemDesignState, stateSchema } from "./schemas.js";
import { getProblem } from "../system-design/problems.js";

describe("system design state compatibility", () => {
  test("initial state starts before the first diagram submission", () => {
    const state = initialSystemDesignState({
      problemId: "url-shortener",
      problemVersion: 2,
      objectives: [],
      difficulty: "MEDIUM",
      phase: "DESIGN_PENDING",
    });
    expect(state.systemDesign?.phase).toBe("DESIGN_PENDING");
    expect(state.systemDesign?.activeRevision).toBe(0);
    expect(state.systemDesign?.questionTarget).toBe(2);
    expect(state.systemDesign?.checkpoints).toEqual([]);
    expect(state.processedTurns).toEqual({});
  });

  test("legacy runtime data gains deterministic checkpoint defaults", () => {
    const state = stateSchema.parse({
      mode: "SYSTEM_DESIGN",
      systemDesign: {
        problemId: "notification-system",
        phase: "DISCUSSION",
        activeRevision: 1,
        activeSubmissionId: "submission-1",
        challengeIssued: false,
        revisionSubmitted: false,
        probesAsked: [],
        selectedProbeIds: [],
      },
      phase: "ARCHITECTURE",
      difficulty: "MEDIUM",
      objectives: [],
      claims: [],
      evidence: [],
      questions: [],
      processedTurns: {},
      ended: false,
    });
    expect(state.systemDesign?.problemVersion).toBe(1);
    expect(state.systemDesign?.questionsAsked).toBe(0);
    expect(state.systemDesign?.questionTarget).toBe(2);
    expect(state.systemDesign?.clarificationAsked).toBe(false);
    expect(state.systemDesign?.failureAsked).toBe(false);
    expect(state.systemDesign?.checkpoints).toEqual([]);
    expect(state.systemDesign?.answerAssessments).toEqual([]);
  });

  test("an interview retains the exact problem brief and incident it started with", () => {
    const problem = getProblem("notification-system")!;
    const state = initialSystemDesignState({
      problemId: problem.id,
      problemVersion: problem.version,
      problemSnapshot: problem,
      objectives: [],
    });
    const restored = stateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(restored.systemDesign?.problemSnapshot).toEqual(problem);
  });
});
