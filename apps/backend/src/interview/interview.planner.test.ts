import { expect, test } from "bun:test";
import type { GithubContext } from "../github/github.types.js";
import type { LlmClient } from "../llm/llm.client.js";
import { InterviewPlanner } from "./interview.planner.js";

const context: GithubContext = {
  repository: {
    owner: "example",
    name: "project",
    url: "https://github.com/example/project",
  },
  languages: [],
  technologies: [],
  dependencies: [],
  architecture: { summary: "A request service", components: [] },
  importantFiles: [{ path: "src/server.ts", reason: "Entry point" }],
  projectSummary: "A request service",
  evidence: [],
};

const opening = {
  kind: "OPENING",
  phase: "PROJECT_OVERVIEW",
  topic: "Project purpose and ownership",
  description: "Explain the project and your decisions",
  whyItMatters: "Establishes scope and ownership",
  targetEvidence: [],
  alternatives: [],
  uncertainties: [],
  sources: [],
  priority: "HIGH",
};

test("an empty opening targetEvidence does not fail repository preparation", async () => {
  const llm = {
    async completeJson() {
      return { role: "backend engineer", difficulty: "mid", objectives: [opening] };
    },
  } as unknown as LlmClient;

  const plan = await new InterviewPlanner(llm).plan(context);
  expect(plan.objectives[0]?.kind).toBe("OPENING");
  expect(plan.objectives[0]?.targetEvidence).toHaveLength(2);
});

test("repository objectives still require specific target evidence", async () => {
  const llm = {
    async completeJson() {
      return {
        role: "backend engineer",
        difficulty: "mid",
        objectives: [
          opening,
          {
            ...opening,
            kind: "REPOSITORY",
            phase: "ARCHITECTURE",
            topic: "Request routing",
            targetEvidence: [],
            sources: [{ path: "src/server.ts" }],
          },
        ],
      };
    },
  } as unknown as LlmClient;

  await expect(new InterviewPlanner(llm).plan(context)).rejects.toThrow();
});
