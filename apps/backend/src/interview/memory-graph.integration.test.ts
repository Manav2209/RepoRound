import { expect, test } from "bun:test";
import { FalkorDB } from "falkordb";
import { randomUUID } from "node:crypto";
import { createFalkorMemoryGraphStore } from "./memory-graph.js";
import type { MemoryFact } from "./memory-facts.js";

const suite = test.skipIf(process.env.RUN_FALKOR_TESTS !== "1");

suite("fact graph replacement is scoped, idempotent, and deletable", async () => {
  const config = {
    host: process.env.FALKORDB_TEST_HOST ?? "localhost",
    port: Number(process.env.FALKORDB_TEST_PORT ?? 6379),
    graph: process.env.FALKORDB_TEST_GRAPH ?? "rr_memory_spec_test",
  };
  const store = createFalkorMemoryGraphStore(config);
  const db = await FalkorDB.connect({ socket: { host: config.host, port: config.port } });
  const graph = db.selectGraph(config.graph);
  const a = `memory_a_${randomUUID()}`;
  const b = `memory_b_${randomUUID()}`;
  const fact = (id: string): MemoryFact => ({
    id, sourceTurnId: `turn_${id}`, questionId: "q1", objectiveId: "cache",
    topic: "cache", text: "Cache misses use the database", observedAt: new Date().toISOString(),
    provenance: "candidate_answer", confidence: 0.7, verification: "candidate_claim", probed: false,
  });
  try {
    await store.replace(a, [fact("first"), fact("second")]);
    await store.replace(b, [fact("other")]);
    await store.replace(a, [fact("second")]);
    const rows = await graph.query<{ interviewId: string; factId: string }>(
      "MATCH (f:InterviewFact) WHERE f.interviewId IN [$a, $b] RETURN f.interviewId AS interviewId, f.factId AS factId ORDER BY factId",
      { params: { a, b } },
    );
    expect(rows.data).toEqual([
      { interviewId: b, factId: "other" },
      { interviewId: a, factId: "second" },
    ]);
    await store.remove(a);
    const remaining = await graph.query<{ count: number }>(
      "MATCH (f:InterviewFact {interviewId: $b}) RETURN count(f) AS count",
      { params: { b } },
    );
    expect(remaining.data?.[0]?.count).toBe(1);
  } finally {
    await store.remove(a);
    await store.remove(b);
    await store.close?.();
    await db.close();
  }
});
