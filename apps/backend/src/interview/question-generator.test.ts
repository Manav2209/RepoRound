import { describe, expect, test } from "bun:test";
import { buildGithubFallback } from "./question-generator.js";
import type { InterviewObjective } from "./interview.types.js";

function objective(
  kind: InterviewObjective["kind"],
  overrides: Partial<InterviewObjective> = {},
): InterviewObjective {
  return {
    id: "objective",
    kind,
    phase: "ARCHITECTURE",
    topic: "job dispatch",
    description: "How jobs are dispatched",
    targetEvidence: ["responsibility"],
    priority: "HIGH",
    status: "NOT_STARTED",
    evidenceIds: [],
    attempts: 0,
    ...overrides,
  };
}

describe("GitHub question fallbacks", () => {
  test("opening asks for scope and personal ownership", () => {
    expect(
      buildGithubFallback({
        objective: objective("OPENING", { phase: "PROJECT_OVERVIEW" }),
        action: { type: "ASK_NEW_TOPIC", objectiveId: "objective" },
      }),
    ).toBe(
      "What does this project do, who is it for, and which architecture decisions were yours?",
    );
  });

  test("repository fallback cites a verified source path when available", () => {
    const text = buildGithubFallback({
      objective: objective("REPOSITORY"),
      action: { type: "ASK_NEW_TOPIC", objectiveId: "objective" },
      verifiedSourcePaths: ["src/queue/dispatcher.ts"],
    });
    expect(text).toContain("src/queue/dispatcher.ts");
  });

  test("repository fallback does not invent a source path", () => {
    const text = buildGithubFallback({
      objective: objective("REPOSITORY"),
      action: { type: "ASK_NEW_TOPIC", objectiveId: "objective" },
    });
    expect(text).not.toContain(".ts");
    expect(text).toContain("job dispatch");
  });

  test("applied fallback makes the changed condition hypothetical", () => {
    const text = buildGithubFallback({
      objective: objective("APPLIED_DESIGN", {
        phase: "TRADEOFFS",
        scenario: {
          changedCondition: "worker capacity drops by half",
          focus: "job dispatch",
          detection: "queue latency",
          newTradeoff: "throughput versus duplicate work",
        },
      }),
      action: { type: "ASK_NEW_TOPIC", objectiveId: "objective" },
    });
    expect(text).toContain("Suppose worker capacity drops by half");
    expect(text).toContain("what tradeoff follows");
  });
});
