import { describe, expect, test } from "bun:test";
import {
  buildGithubFallback,
  QuestionGenerator,
} from "./question-generator.js";
import { RepositoryKnowledge } from "../github/knowledge.js";
import { initialState, stateSchema } from "./schemas.js";
import type { LlmClient } from "../llm/llm.client.js";
import { prisma } from "@repo/db";
import { createTestUser } from "../../test-fixtures/database.js";
import { randomUUID } from "node:crypto";
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
  test("opening starts with a concrete flow instead of scope or ownership", () => {
    const text = buildGithubFallback({
      objective: objective("OPENING", { phase: "PROJECT_OVERVIEW" }),
      action: { type: "ASK_NEW_TOPIC", objectiveId: "objective" },
      verifiedSourcePaths: ["src/queue/dispatcher.ts"],
    });
    expect(text).toContain("src/queue/dispatcher.ts");
    expect(text).toContain("one request");
    expect(text).not.toMatch(
      /who is it for|were yours|what does this project do/i,
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

describe.skipIf(process.env.RUN_DB_TESTS !== "1")(
  "GitHub interview introduction",
  () => {
    async function opening(generated: unknown) {
      const userId = await createTestUser();
      const interviewId = `intro_${randomUUID()}`;
      await prisma.interview.create({
        data: { id: interviewId, userId, status: "ready" },
      });
      const llm = {
        completeJson: async () => {
          if (generated instanceof Error) throw generated;
          return generated;
        },
      } as unknown as LlmClient;
      const state = initialState(
        [
          objective("OPENING", {
            phase: "PROJECT_OVERVIEW",
            sources: [{ path: "src/queue/dispatcher.ts" }],
          }),
        ],
        "mid",
      );
      const knowledge = new RepositoryKnowledge(
        "abc123",
        [
          {
            path: "src/queue/dispatcher.ts",
            content: "export function dispatch(job) { return queue.add(job); }",
          },
        ],
        [],
        {
          projectSummary: "This project dispatches background jobs for an API.",
        },
      );
      try {
        const question = await new QuestionGenerator(llm).generate(
          interviewId,
          state,
          state.objectives[0]!,
          { type: "ASK_NEW_TOPIC", objectiveId: "objective" },
          knowledge,
          [],
          15,
        );
        state.questions.push(question);
        expect(() => stateSchema.parse(state)).not.toThrow();
        return question;
      } finally {
        await prisma.user.delete({ where: { id: userId } });
      }
    }

    test("summarizes the submitted project before a source-backed question", async () => {
      const question = await opening({
        introduction:
          "The project you've presented processes background jobs for an API.",
        question:
          "What happens to a job if dispatch fails before it reaches the queue?",
        referenceIndexes: [0],
      });
      expect(question.text).toStartWith(
        "The project you've presented processes background jobs",
      );
      expect(question.text).toContain("What happens to a job");
      expect(question.repositoryReferences?.[0]?.path).toBe(
        "src/queue/dispatcher.ts",
      );
    });

    test("model failure still produces a summary and a technical question", async () => {
      const question = await opening(new Error("provider unavailable"));
      expect(question.text).toContain("dispatches background jobs");
      expect(question.text).toContain("src/queue/dispatcher.ts");
      expect(question.text).not.toContain("were yours");
    });

    test("rejects a model that falls back to the old generic opening", async () => {
      const question = await opening({
        introduction: "An API with background jobs.",
        question:
          "What does this project do, who is it for, and which architecture decisions were yours?",
        referenceIndexes: [],
      });
      expect(question.text).toContain("src/queue/dispatcher.ts");
      expect(question.text).not.toContain("What does this project do");
    });
  },
);
