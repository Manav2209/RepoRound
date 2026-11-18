import { expect, test } from "bun:test";
import { PROBLEMS, getProblem } from "./problems.js";
import { selectProbe, type ProbeContext } from "./probes.js";
import { initialSystemDesignState } from "../interview/schemas.js";
import {
  introQuestion,
  phraseProbeQuestion,
  failureQuestion,
} from "../interview/strategies/system-design.js";
import type { LlmClient } from "../llm/llm.client.js";
import type { ProblemConfig } from "@repo/voice-types";

function context(
  problem: ProblemConfig,
  overrides: Partial<ProbeContext> = {},
): ProbeContext {
  return {
    problem,
    submissionId: "submission-2",
    revision: 2,
    components: [
      { componentId: "api", kind: "api_service", label: "Candidate API" },
      { componentId: "db", kind: "database", label: "Candidate Store" },
    ],
    edges: [
      {
        edgeId: "edge",
        sourceId: "api",
        targetId: "db",
        sourceKind: "api_service",
        targetKind: "database",
      },
    ],
    upstreamByProvider: {},
    askedProbeIds: [],
    ...overrides,
  };
}

test.each(PROBLEMS)(
  "$id has bounded original wording for all three slots",
  (problem) => {
    const bank = problem.questionBank!;
    const ids = bank.middle.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(bank.middle).toHaveLength(3);
    for (const prompt of [
      bank.opening,
      ...bank.middle.map((question) => question.prompt),
      bank.final,
    ]) {
      expect(prompt.length).toBeLessThanOrEqual(320);
      expect(prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(35);
      expect((prompt.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    }
    expect(problem.challenge.prompt).toBe(bank.final);
  },
);

test.each(PROBLEMS)(
  "$id executes its own opening, middle, and incident without a model call",
  async (problem) => {
    const state = initialSystemDesignState({
      problemId: problem.id,
      problemSnapshot: problem,
      activeRevision: 2,
      objectives: [],
    });
    const probe = selectProbe(context(problem));
    expect(probe.probeId).toStartWith(`${problem.id}.`);
    expect(probe.probeId).not.toStartWith("generic.");
    let calls = 0;
    const llm = {
      completeJson: async () => {
        calls++;
        throw new Error("Checked bank must not be paraphrased");
      },
    } as unknown as LlmClient;
    const opening = introQuestion(state, problem);
    const middle = await phraseProbeQuestion({
      llm,
      interviewId: "test",
      problem,
      probe,
      components: context(problem).components,
      state,
    });
    const final = failureQuestion(state, problem);
    expect(opening.text).toBe(problem.questionBank!.opening);
    expect(middle.text).toBe(
      problem.questionBank!.middle.find(
        (question) => question.id === probe.probeId,
      )!.prompt,
    );
    expect(middle.concern).not.toBe("FAILURE");
    expect(final.text).toBe(problem.questionBank!.final);
    expect(final.concern).toBe("FAILURE");
    expect(calls).toBe(0);
  },
);

test("an already-asked mechanism selects a different middle question", () => {
  const problem = getProblem("url-shortener")!;
  const first = selectProbe(context(problem));
  const next = selectProbe(
    context(problem, { askedProbeIds: [first.probeId] }),
  );
  expect(next.probeId).not.toBe(first.probeId);
});

test("a detailed assessed mechanism can select an uncovered alternate", () => {
  const problem = getProblem("url-shortener")!;
  const explanation =
    "Our create path enforces a unique code constraint inside the authoritative database transaction. A collision rejects the losing insert, and we retry with a newly generated code before returning a short link.";
  expect(
    selectProbe(context(problem, { coveredTopics: [explanation] })).probeId,
  ).not.toBe("url-shortener.code-collision");
});

test.each([
  "collision unique retry",
  "We do not have a mechanism for collision handling or unique constraints, and we cannot explain which requests retry or why the current implementation would keep mappings safe under concurrent writes.",
])("thin or negative keyword claims do not skip the core probe", (answer) => {
  expect(
    selectProbe(
      context(getProblem("url-shortener")!, { coveredTopics: [answer] }),
    ).probeId,
  ).toBe("url-shortener.code-collision");
});

test("unknown topology and graph outages keep a problem-specific question without invented edges", async () => {
  const problem = getProblem("file-storage")!;
  const ctx = context(problem, { components: [], edges: [] });
  const probe = selectProbe(ctx);
  expect(probe.referencedComponentIds).toEqual([]);
  expect(probe.graphPath).toEqual([]);
  const state = initialSystemDesignState({
    problemId: problem.id,
    activeRevision: 1,
    objectives: [],
  });
  const question = await phraseProbeQuestion({
    llm: {} as LlmClient,
    interviewId: "test",
    problem,
    probe: { ...probe, probeId: "snapshot.flow" },
    components: [],
    state,
  });
  expect(question.text).toBe(problem.questionBank!.middle[0]!.prompt);
  expect(question.text).not.toContain("You connected");
});

test("bank wording is pinned to the supplied snapshot and older snapshots retain their original incident", async () => {
  const current = getProblem("chat-application")!;
  const snapshot = structuredClone(current);
  snapshot.questionBank!.middle[0]!.prompt =
    "Where does this saved design establish conversation order?";
  snapshot.questionBank!.final =
    "This saved connection server crashes. How are missing messages recovered?";
  const state = initialSystemDesignState({
    problemId: snapshot.id,
    problemSnapshot: snapshot,
    activeRevision: 1,
    objectives: [],
  });
  const question = await phraseProbeQuestion({
    llm: {} as LlmClient,
    interviewId: "test",
    problem: snapshot,
    probe: selectProbe(context(snapshot)),
    components: [],
    state,
  });
  expect(question.text).toBe(snapshot.questionBank!.middle[0]!.prompt);
  expect(failureQuestion(state, snapshot).text).toBe(
    snapshot.questionBank!.final,
  );
  expect(current.questionBank!.final).not.toBe(snapshot.questionBank!.final);
  const legacy = {
    ...snapshot,
    version: 2,
    questionBank: undefined,
    challenge: { ...snapshot.challenge, prompt: "Original saved incident." },
  };
  expect(failureQuestion(state, legacy).text).toStartWith(
    "Original saved incident.",
  );
});
