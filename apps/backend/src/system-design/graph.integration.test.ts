import { afterAll, expect, test } from "bun:test";
import { createFalkorDesignGraphStore, type DesignGraphStore } from "./graph.js";
import { selectProbe } from "./probes.js";
import { getProblem } from "./problems.js";
import type { ArchitectureSnapshot } from "@repo/voice-types";

const HOST = process.env.FALKORDB_TEST_HOST ?? "localhost";
const PORT = Number(process.env.FALKORDB_TEST_PORT ?? 6379);
const GRAPH = process.env.FALKORDB_TEST_GRAPH ?? "ai_interviewer_test";

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const store = createFalkorDesignGraphStore({ host: HOST, port: PORT, graph: GRAPH });
const available = await withTimeout(store.ping(), 4000, false);

afterAll(async () => {
  if (available) await store.close();
});

const suite = test.skipIf(!available);

function notificationSnapshot(): ArchitectureSnapshot {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "api",
        position: { x: 0, y: 0 },
        data: { componentType: "api_service", label: "API" },
      },
      {
        id: "queue",
        position: { x: 200, y: 0 },
        data: { componentType: "message_queue", label: "Queue" },
      },
      {
        id: "worker",
        position: { x: 400, y: 0 },
        data: { componentType: "worker", label: "Worker" },
      },
      {
        id: "sms",
        position: { x: 600, y: 0 },
        data: { componentType: "external_service", label: "SMS Provider" },
      },
    ],
    edges: [
      { id: "e1", source: "api", target: "queue" },
      { id: "e2", source: "queue", target: "worker" },
      { id: "e3", source: "worker", target: "sms" },
    ],
  };
}

function scoped(store: DesignGraphStore, submissionId: string) {
  return {
    install: () =>
      store.install({
        interviewId: "interview-test",
        submissionId,
        revision: 1,
        snapshot: notificationSnapshot(),
      }),
  };
}

suite("FalkorDB Cypher traversal over a real submission", async () => {
  const submissionId = `sub-${Date.now()}-a`;
  await scoped(store, submissionId).install();

  const verified = await store.verify({
    submissionId,
    revision: 1,
    expectedNodes: 4,
    expectedEdges: 3,
  });
  expect(verified.nodeCount).toBe(4);
  expect(verified.edgeCount).toBe(3);
  expect(verified.crossSubmissionEdges).toBe(0);

  const components = await store.components(submissionId);
  expect(components.map((c) => c.componentId)).toEqual([
    "api",
    "queue",
    "sms",
    "worker",
  ]);

  const edges = await store.edges(submissionId);
  expect(edges).toHaveLength(3);

  const pairs = await store.queueWorkerPairs(submissionId);
  expect(pairs).toEqual([{ queueId: "queue", workerId: "worker" }]);

  const upstream = await store.upstreamPaths({
    submissionId,
    providerId: "sms",
    maxHops: 5,
  });
  const upstreamIds = upstream.map((u) => u.upstreamId).sort();
  expect(upstreamIds).toEqual(["api", "queue", "worker"]);

  const isolated = await store.isolatedComponents(submissionId);
  expect(isolated).toEqual([]);
});

suite("graph reads stay scoped to one immutable submission", async () => {
  const first = `sub-${Date.now()}-b1`;
  const second = `sub-${Date.now()}-b2`;
  await scoped(store, first).install();
  await scoped(store, second).install();

  const firstComponents = await store.components(first);
  const secondComponents = await store.components(second);
  expect(firstComponents).toHaveLength(4);
  expect(secondComponents).toHaveLength(4);

  const cross = await store.verify({
    submissionId: first,
    revision: 1,
    expectedNodes: 4,
    expectedEdges: 3,
  });
  expect(cross.crossSubmissionEdges).toBe(0);

  await store.removeSubmission(second);
  expect(await store.components(second)).toHaveLength(0);
  expect(await store.components(first)).toHaveLength(4);
});

suite("real graph facts drive deterministic probe selection", async () => {
  const submissionId = `sub-${Date.now()}-c`;
  await scoped(store, submissionId).install();

  const components = await store.components(submissionId);
  const edges = await store.edges(submissionId);
  const probe = selectProbe({
    problem: getProblem("notification-system")!,
    submissionId,
    revision: 1,
    components,
    edges,
    upstreamByProvider: {},
    askedProbeIds: [],
  });

  expect(probe.probeId).toBe("notif.async-buffer-ack");
  expect(probe.graphPath).toEqual(["api", "queue", "worker"]);
  expect(probe.submissionId).toBe(submissionId);
});
