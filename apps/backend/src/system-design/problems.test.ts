import { expect, test } from "bun:test";
import { PROBLEMS, getProblem, problemSummaries } from "./problems.js";
import { selectProbe, type ProbeContext } from "./probes.js";
import type { ComponentFact, EdgeFact } from "./graph.js";

const REPRESENTATIVES = ["notification-system", "url-shortener", "chat-application"];

test("the catalog exposes ten unique, versioned, fully-populated problems", () => {
  expect(PROBLEMS).toHaveLength(10);
  const ids = PROBLEMS.map((p) => p.id);
  expect(new Set(ids).size).toBe(10);
  for (const problem of PROBLEMS) {
    expect(problem.version).toBe(2);
    expect(problem.title.length).toBeGreaterThan(0);
    expect(problem.brief.length).toBeGreaterThan(0);
    expect(problem.visibleRequirements.length).toBeGreaterThan(0);
    expect(Object.keys(problem.clarificationAnswers).length).toBeGreaterThan(0);
    expect(problem.evaluationGoals.length).toBeGreaterThan(0);
    expect(problem.challenge.id.length).toBeGreaterThan(0);
    expect(problem.challenge.prompt.length).toBeGreaterThan(0);
    expect(problem.challenge.targetConcepts.length).toBeGreaterThan(0);
  }
});

test("ProblemSummary omits internal-only configuration", () => {
  const summaries = problemSummaries();
  expect(summaries).toHaveLength(10);
  for (const summary of summaries) {
    expect(summary).toEqual({
      id: summary.id,
      version: summary.version,
      title: summary.title,
      difficulty: summary.difficulty,
      brief: summary.brief,
      visibleRequirements: summary.visibleRequirements,
      loadAssumption: summary.loadAssumption,
      constraints: summary.constraints,
    });
  }
});

test("the demo problem carries the scripted SMS outage challenge", () => {
  const notification = getProblem("notification-system");
  expect(notification?.challenge.id).toBe("sms-provider-outage");
  expect(notification?.difficulty).toBe("HARD");
});

function facts(): { components: ComponentFact[]; edges: EdgeFact[] } {
  const spec = [
    ["api", "api_service", "Public API"],
    ["queue", "message_queue", "Requests Queue"],
    ["worker", "worker", "Delivery Worker"],
    ["sms", "external_service", "SMS Provider"],
    ["db", "database", "Primary Store"],
  ] as const;
  const components = spec.map(([componentId, kind, label]) => ({
    componentId,
    kind,
    label,
  }));
  const edges: EdgeFact[] = (
    [
      ["api", "queue"],
      ["queue", "worker"],
      ["worker", "sms"],
      ["api", "db"],
    ] as const
  ).map(([sourceId, targetId]) => ({
    edgeId: `${sourceId}-${targetId}`,
    sourceId,
    sourceKind: components.find((c) => c.componentId === sourceId)!.kind,
    targetId,
    targetKind: components.find((c) => c.componentId === targetId)!.kind,
  }));
  return { components, edges };
}

function contextFor(problemId: string, askedProbeIds: string[] = []): ProbeContext {
  const problem = getProblem(problemId)!;
  const { components, edges } = facts();
  return {
    problem,
    submissionId: "sub-1",
    revision: 1,
    components,
    edges,
    upstreamByProvider: { sms: [{ upstreamId: "worker", upstreamLabel: "Delivery Worker" }] },
    askedProbeIds,
  };
}

test("the shared probe policy selects a graph-grounded probe for each representative", () => {
  const notification = selectProbe(contextFor("notification-system"));
  expect(notification.probeId).toBe("notif.async-buffer-ack");
  expect(notification.graphPath).toEqual(["api", "queue", "worker"]);

  const chat = selectProbe(contextFor("chat-application"));
  expect(chat.probeId).toBe("generic.async");
  expect(chat.graphPath).toEqual(["api", "queue", "worker"]);

  for (const problemId of REPRESENTATIVES) {
    const probe = selectProbe(contextFor(problemId));
    const { components } = facts();
    for (const id of probe.referencedComponentIds) {
      expect(components.some((c) => c.componentId === id)).toBe(true);
    }
  }
});

test("an unrecognizable topology cannot invent graph facts and stays deterministic", () => {
  const problem = getProblem("url-shortener")!;
  const ctx: ProbeContext = {
    problem,
    submissionId: "sub-2",
    revision: 1,
    components: [{ componentId: "db", kind: "database", label: "Store" }],
    edges: [],
    upstreamByProvider: {},
    askedProbeIds: [],
  };
  const probe = selectProbe(ctx);
  expect(probe.probeId).toBe("generic.scaling-fallback");
  expect(probe.referencedComponentIds).toEqual([]);
  expect(probe.graphPath).toEqual([]);
});
