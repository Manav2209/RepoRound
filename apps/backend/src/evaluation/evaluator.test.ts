import { expect, test } from "bun:test";
import { Evaluator, emptyEvaluation } from "./evaluator.js";
import type { EvaluationContext } from "./evaluation.types.js";
import type { LlmClient } from "../llm/llm.client.js";

const context: EvaluationContext = {
  projectContext: {
    owner: "example",
    name: "project",
    projectSummary: "",
    technologies: [],
    architecture: "",
    importantFiles: [],
    evidence: [],
  },
  plan: { role: "Engineer", difficulty: "MEDIUM", topics: [], objectives: [] },
  transcript: [],
  candidateEvidence: [],
  questionHistory: [],
};

test("partial input is disclosed, retains the late answer, and caps assessment confidence", async () => {
  let submitted: Record<string, unknown> | undefined;
  const fake = {
    async completeJson(messages: { role: string; content: string }[]) {
      submitted = JSON.parse(messages[1]!.content);
      const result = emptyEvaluation();
      result.evidence.architecture = {
        level: "BASIC",
        score: 40,
        confidence: 0.99,
        evidenceIds: ["turn-0"],
        observations: [{ turnId: "turn-0", quote: "Opening explanation" }],
        explanation: "Explains the boundary",
      };
      expect(messages.reduce((n, m) => n + m.content.length, 0)).toBeLessThan(
        60000,
      );
      return result;
    },
  } as unknown as LlmClient;
  const result = await new Evaluator(fake).evaluate({
    ...context,
    transcript: [
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `turn-${i}`,
        role: "user" as const,
        text: "Opening explanation " + "x".repeat(2000),
      })),
      { id: "last", role: "user", text: "UNIQUE_FINAL_REASONING" },
    ],
  });
  expect(JSON.stringify(submitted)).toContain("UNIQUE_FINAL_REASONING");
  expect(result.coverage?.quality).toBe("partial");
  expect(result.evidence.architecture!.confidence).toBe(0.65);
  expect(result.feedback).toStartWith("Partial assessment:");
});
test("invented evidence IDs cannot produce scores or unsupported strengths", async () => {
  const fake = {
    async completeJson() {
      const result = emptyEvaluation();
      result.score = 100;
      result.strengths = ["Expert"];
      result.weaknesses = ["Did not discuss debugging"];
      for (const item of Object.values(result.evidence))
        Object.assign(item, {
          level: "ADVANCED",
          evidenceIds: ["invented"],
          confidence: 1,
        });
      return result;
    },
  } as unknown as LlmClient;
  const result = await new Evaluator(fake).evaluate({
    ...context,
    transcript: [
      {
        id: "turn_real",
        role: "user",
        text: "I use a cache for repeated requests.",
      },
    ],
  });
  expect(result.score).toBeNull();
  expect(result.strengths).toEqual([]);
  expect(result.weaknesses).toEqual([]);
  expect(
    Object.values(result.evidence).every(
      (e) => e.level === "INSUFFICIENT_EVIDENCE",
    ),
  ).toBe(true);
});

test("a single strong example cannot support an advanced assessment", async () => {
  const fake = {
    async completeJson() {
      const result = emptyEvaluation();
      result.score = 80;
      result.evidence.technicalDepth = {
        level: "ADVANCED",
        evidenceIds: ["ev_1"],
        confidence: 1,
        explanation: "One example",
      };
      return result;
    },
  } as unknown as LlmClient;
  const result = await new Evaluator(fake).evaluate({
    ...context,
    candidateEvidence: [
      {
        id: "ev_1",
        objectiveId: "obj_1",
        skill: "technicalDepth",
        topic: "cache",
        evidence: "Explained cache eviction",
        sourceTurnId: "turn_1",
        strength: "STRONG",
        confidence: 0.7,
      },
    ],
  });
  expect(result.evidence.technicalDepth!.level).toBe("INTERMEDIATE");
  expect(result.evidence.technicalDepth!.confidence).toBe(0.7);
});

test("final scoring uses quoted answers even when live evidence is missing or uncertain", async () => {
  const fake = {
    async completeJson() {
      const result = emptyEvaluation();
      result.evidence.architecture = {
        level: "BASIC",
        score: 42,
        confidence: 0.85,
        evidenceIds: ["turn_1"],
        observations: [
          {
            turnId: "turn_1",
            quote: "The orchestrator sends commands through Redis streams",
          },
        ],
        explanation:
          "Identifies message flow but does not explain failure handling.",
      };
      return result;
    },
  } as unknown as LlmClient;
  const result = await new Evaluator(fake).evaluate({
    ...context,
    transcript: [
      {
        id: "turn_1",
        role: "user",
        text: "The orchestrator sends commands through Redis streams to the sandboxes.",
      },
    ],
  });
  expect(result.score).toBe(42);
  expect(result.dimensions.projectUnderstanding).toBe(42);
  expect(result.dimensions.problemSolving).toBeNull();
  expect(result.evidence.architecture!.confidence).toBe(0.85);
});

test("fabricated quotes and assistant text cannot support a score", async () => {
  const fake = {
    async completeJson() {
      const result = emptyEvaluation();
      result.evidence.debugging = {
        level: "ADVANCED",
        score: 95,
        confidence: 1,
        evidenceIds: ["turn_1", "turn_ai"],
        observations: [
          { turnId: "turn_1", quote: "I diagnosed a distributed deadlock" },
          { turnId: "turn_ai", quote: "Check the deadlock logs" },
        ],
        explanation: "Invented expertise",
      };
      return result;
    },
  } as unknown as LlmClient;
  const result = await new Evaluator(fake).evaluate({
    ...context,
    transcript: [
      { id: "turn_1", role: "user", text: "I do not know how to debug that." },
      { id: "turn_ai", role: "assistant", text: "Check the deadlock logs" },
    ],
  });
  expect(result.score).toBeNull();
  expect(result.evidence.debugging!.evidenceIds).toEqual([]);
});

test("zero is a valid score for an observed answer, not missing evidence", async () => {
  const fake = {
    async completeJson() {
      const result = emptyEvaluation();
      result.evidence.technicalDepth = {
        level: "BASIC",
        score: 0,
        confidence: 0.9,
        evidenceIds: ["turn_1"],
        observations: [{ turnId: "turn_1", quote: "SQL has no tables" }],
        explanation: "An explicitly incorrect explanation of SQL.",
      };
      return result;
    },
  } as unknown as LlmClient;
  const result = await new Evaluator(fake).evaluate({
    ...context,
    transcript: [{ id: "turn_1", role: "user", text: "SQL has no tables" }],
  });
  expect(result.score).toBe(0);
  expect(result.dimensions.technicalKnowledge).toBe(0);
});

test("answer indices resolve to actual turn IDs and reject out-of-range citations", async () => {
  const fake = {
    async completeJson() {
      const result = emptyEvaluation();
      return {
        ...result,
        evidence: {
          ...result.evidence,
          architecture: {
            level: "INTERMEDIATE",
            score: 65,
            confidence: 0.8,
            explanation: "Describes service boundaries",
            evidenceIds: [],
            observations: [
              {
                answerIndex: 1,
                quote: "The ingress routes requests to the backend",
              },
              { answerIndex: 99, quote: "Invented" },
            ],
          },
        },
      };
    },
  } as unknown as LlmClient;
  const result = await new Evaluator(fake).evaluate({
    ...context,
    transcript: [
      { id: "turn_1", role: "user", text: "Hello" },
      {
        id: "turn_2",
        role: "user",
        text: "The ingress routes requests to the backend.",
      },
    ],
  });
  expect(result.score).toBe(65);
  expect(result.evidence.architecture!.evidenceIds).toEqual(["turn_2"]);
  expect(result.evidence.architecture!.observations).toEqual([
    { turnId: "turn_2", quote: "The ingress routes requests to the backend" },
  ]);
});
