import { expect, test } from "bun:test";
import { usableDecisionQuestion } from "./decision-questions.js";
import { RepositoryKnowledge } from "../github/knowledge.js";
import { InterviewPlanner } from "./interview.planner.js";
import { QuestionGenerator } from "./question-generator.js";
import { initialState, stateSchema } from "./schemas.js";
import { selectGithubAction } from "./github-policy.js";
import type { GithubContext } from "../github/github.types.js";
import type { LlmClient } from "../llm/llm.client.js";

const knowledge = new RepositoryKnowledge(
  "a".repeat(40),
  [
    {
      path: "src/jobs.ts",
      content:
        "export async function accept(job) {\n  await durableQueue.add(job);\n  return { accepted: true };\n}",
    },
  ],
  [],
  { projectSummary: "A background generation service." },
);
const context: GithubContext = {
  repository: {
    owner: "fixture",
    name: "jobs",
    url: "https://github.com/fixture/jobs",
  },
  languages: [],
  technologies: [],
  dependencies: [],
  architecture: { summary: "API and worker", components: [] },
  importantFiles: [{ path: "src/jobs.ts", reason: "Accepts generation jobs" }],
  projectSummary: "A background generation service.",
  evidence: [],
};
const card = {
  supportingQuote: "await durableQueue.add(job);",
  question:
    "What requirement made background generation jobs a better fit than processing the prompt inside the API request?",
  followUps: [
    "What tradeoff does asynchronous processing introduce for the user waiting for a generated application?",
  ],
  observedBehavior: "The API waits for queue acceptance.",
  assessmentFocus: "Explains why the workflow benefits from asynchronous work.",
  evidenceIndexes: [0],
};
const intent = {
  kind: "OPENING",
  phase: "PROJECT_OVERVIEW",
  topic: "Generation delivery",
  description: "Reason for asynchronous generation",
  whyItMatters: "User responsiveness",
  targetEvidence: ["Relates the requirement to the approach"],
  sources: [{ path: "src/jobs.ts" }],
  priority: "HIGH",
  decision: card,
};

test("preparation binds spoken decision questions to real implementation references and rejects invented evidence", async () => {
  const llm = {
    completeJson: async () => ({
      role: "Engineer",
      difficulty: "mid",
      objectives: [
        {
          ...intent,
          decision: { ...card, observedBehavior: "", evidenceIndexes: [] },
        },
        { ...intent, kind: "REPOSITORY", phase: "ARCHITECTURE" },
        {
          ...intent,
          kind: "REPOSITORY",
          topic: "Invented storage",
          decision: {
            ...card,
            supportingQuote: "await inventedStorage.save(job);",
            evidenceIndexes: [999],
          },
        },
      ],
    }),
  } as unknown as LlmClient;
  const plan = await new InterviewPlanner(llm).plan(context, knowledge);
  expect(plan.objectives).toHaveLength(1);
  expect(plan.objectives[0]!.decision!.references[0]!.path).toBe("src/jobs.ts");
  expect(plan.objectives[0]!.decision!.question).toBe(card.question);
});

test("prepared opening and fallback follow-up use no model request and survive runtime serialization", async () => {
  const llm = {
    completeJson: async () => ({
      role: "Engineer",
      difficulty: "mid",
      objectives: [intent],
    }),
  } as unknown as LlmClient;
  const plan = await new InterviewPlanner(llm).plan(context, knowledge);
  const state = stateSchema.parse(initialState(plan.objectives, "mid"));
  const objective = state.objectives[0]!;
  let calls = 0;
  const noModel = {
    completeJson: async () => {
      calls++;
      throw new Error("Must use prepared questions");
    },
  } as unknown as LlmClient;
  const generator = new QuestionGenerator(noModel);
  const opening = await generator.generate(
    "fixture",
    state,
    objective,
    { type: "ASK_NEW_TOPIC", objectiveId: objective.id },
    knowledge,
    [],
    15,
  );
  expect(opening.text).toContain(card.question);
  expect(opening.text).not.toContain("src/jobs.ts");
  state.questions.push(opening);
  const followUp = await generator.generate(
    "fixture",
    state,
    objective,
    { type: "ASK_CLARIFICATION", objectiveId: objective.id },
    knowledge,
    [],
    12,
    {
      skipModel: true,
      proposal: {
        question: "What responsibility does src/jobs.ts own?",
        referenceIndexes: [0],
      },
      excerpts: [knowledge.getFile("src/jobs.ts")!],
    },
  );
  expect(followUp.text).toBe(card.followUps[0]!);
  expect(calls).toBe(0);
  state.lastAssessment = {
    objectiveId: objective.id,
    turnId: "t",
    answeredQuestion: true,
    explainedResponsibilities: false,
    identifiedTradeoffOrFailure: false,
    consistentWithEvidence: true,
    objectiveSatisfied: false,
  };
  expect(selectGithubAction(state, 10)).toEqual({ type: "END_INTERVIEW" });
  expect(state.github!.maxFollowUps).toBe(2);
});

test("unsupported preparation fails clearly instead of fabricating a generic interview", async () => {
  const llm = {
    completeJson: async () => ({
      role: "Engineer",
      difficulty: "mid",
      objectives: [
        {
          ...intent,
          decision: {
            ...card,
            supportingQuote: "await inventedStorage.save(job);",
            evidenceIndexes: [999],
          },
        },
      ],
    }),
  } as unknown as LlmClient;
  await expect(
    new InterviewPlanner(llm).plan(context, knowledge),
  ).rejects.toThrow("implementation evidence");
  for (const text of [
    "Why did you choose Redis?",
    "What is Docker?",
    "What responsibility does jobs.ts own?",
    "What breaks first under load?",
    "What does your project do?",
  ])
    expect(usableDecisionQuestion(text)).toBe(false);
});

test("preparation review repairs a filename question using a narrow implementation context", async () => {
  const broader = new RepositoryKnowledge(
    knowledge.commitSha,
    [
      ...knowledge.files,
      {
        path: "src/health.ts",
        content: "export function healthy() { return true; }",
      },
    ],
    [],
    {},
  );
  let calls = 0;
  const llm = {
    completeJson: async (messages: Array<{ content: string }>) => {
      calls++;
      if (calls === 1)
        return {
          role: "Engineer",
          difficulty: "mid",
          objectives: [
            {
              ...intent,
              decision: {
                ...card,
                question: "What responsibility does src/jobs.ts own?",
              },
            },
          ],
        };
      const data = JSON.parse(messages[1]!.content);
      expect(data.implementationEvidence.length).toBeLessThanOrEqual(2);
      expect(
        data.implementationEvidence.some((item: { content: string }) =>
          item.content.includes("durableQueue.add"),
        ),
      ).toBe(true);
      return card;
    },
  } as unknown as LlmClient;
  const plan = await new InterviewPlanner(llm).plan(context, broader);
  expect(calls).toBe(2);
  expect(plan.objectives[0]!.decision!.question).toBe(card.question);
  expect(plan.objectives[0]!.targetEvidence).toEqual([card.assessmentFocus]);
});

test("observed delivery and workspace decisions retain grounded questions when preparation review is unavailable", async () => {
  const source = new RepositoryKnowledge(
    knowledge.commitSha,
    [
      ...knowledge.files,
      {
        path: "src/security.ts",
        content:
          "export function resolveSafePath(baseDir, inputPath) {\n  const resolved = path.resolve(baseDir, inputPath);\n  if (path.relative(baseDir, resolved).startsWith('..')) throw new Error('escape');\n  return resolved;\n}",
      },
    ],
    [],
    {},
  );
  const unavailable = {
    completeJson: async () => {
      throw new Error("Review unavailable");
    },
  } as unknown as LlmClient;
  const plan = await new InterviewPlanner(unavailable).plan(context, source);
  expect(plan.objectives).toHaveLength(2);
  expect(plan.objectives.map((item) => item.kind)).toEqual([
    "OPENING",
    "REPOSITORY",
  ]);
  expect(plan.objectives[0]!.decision!.question).toContain(
    "message-based delivery",
  );
  expect(plan.objectives[1]!.decision!.question).toContain("workspace");
  expect(
    plan.objectives.every((item) =>
      item.decision!.references.every((ref) => source.validReference(ref)),
    ),
  ).toBe(true);
});
