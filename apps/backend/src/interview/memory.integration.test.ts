import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { prisma } from "@repo/db";
import { createTestUser } from "../../test-fixtures/database.js";
import { initialSystemDesignState } from "./schemas.js";
import { reconcileMemoryGraph, setMemoryGraphStore, type MemoryGraphStore } from "./memory-graph.js";
import { reconcileInterviewCleanup } from "./cleanup.js";
import { setDesignGraphStore, type DesignGraphStore } from "../system-design/graph.js";
import type { MemoryFact } from "./memory-facts.js";
import { createResultsRouter } from "../api/results.js";
import { EvaluationService } from "../evaluation/evaluation.service.js";
import type { LlmClient } from "../llm/llm.client.js";

const suite = test.skipIf(process.env.RUN_DB_TESTS !== "1");

class FakeMemoryGraph implements MemoryGraphStore {
  fail = false;
  writes = 0;
  facts = new Map<string, MemoryFact[]>();
  async replace(interviewId: string, facts: MemoryFact[]): Promise<void> {
    if (this.fail) throw new Error("graph unavailable");
    this.writes++;
    this.facts.set(interviewId, structuredClone(facts));
  }
  async remove(interviewId: string): Promise<void> {
    if (this.fail) throw new Error("graph unavailable");
    this.facts.delete(interviewId);
  }
}

afterAll(async () => {
  setMemoryGraphStore(null);
  setDesignGraphStore(null);
  await prisma.$disconnect();
});

suite("projection outage and cleanup retry preserve the report", async () => {
  const graph = new FakeMemoryGraph();
  const removedDesign: string[] = [];
  setMemoryGraphStore(graph);
  setDesignGraphStore({ removeSubmission: async (id: string) => { removedDesign.push(id); } } as DesignGraphStore);
  const userId = await createTestUser();
  const interviewId = `memory_${randomUUID()}`;
  const turnId = `turn_${randomUUID()}`;
  const submissionId = `submission_${randomUUID()}`;
  const sessionId = `session_${randomUUID()}`;
  const state = initialSystemDesignState({ problemId: "url-shortener", objectives: [] });
  state.memoryFacts = [{
    id: `design_${turnId}`, sourceTurnId: turnId, questionId: "q1",
    objectiveId: "design_flow", topic: "flow", text: "The cache absorbs redirect reads",
    observedAt: new Date().toISOString(), provenance: "candidate_answer",
    confidence: 0.6, verification: "candidate_claim", probed: false,
  }];
  await prisma.interview.create({ data: { id: interviewId, userId, mode: "SYSTEM_DESIGN", status: "active" } });
  await prisma.interviewRuntime.create({ data: { interviewId, version: 1, data: state as never, deadlineAt: new Date(Date.now() + 60_000) } });
  await prisma.interviewMemoryProjection.create({ data: { interviewId, version: 1 } });
  await prisma.interviewSession.create({ data: { id: sessionId, interviewId, roomName: sessionId, serverUrl: "http://localhost" } });
  await prisma.conversationTurn.create({ data: { id: turnId, interviewId, sessionId, turnIndex: 0, role: "user", text: "The cache absorbs redirect reads", questionId: "q1", analysisStatus: "completed" } });
  await prisma.systemDesignSubmission.create({ data: {
    id: submissionId, interviewId, revision: 1, requestId: randomUUID(),
    snapshot: { schemaVersion: 1, nodes: [], edges: [] }, snapshotHash: "hash", graphStatus: "READY",
  } });

  graph.fail = true;
  await reconcileMemoryGraph();
  expect((await prisma.interviewMemoryProjection.findUniqueOrThrow({ where: { interviewId } })).projectedVersion).toBe(0);
  expect(await prisma.conversationTurn.count({ where: { interviewId } })).toBe(1);
  graph.fail = false;
  await reconcileMemoryGraph();
  expect(graph.facts.get(interviewId)?.[0]?.sourceTurnId).toBe(turnId);
  await reconcileMemoryGraph();
  expect(graph.writes).toBe(1);

  await prisma.evaluation.create({ data: { interviewId, score: 75, dimensions: {}, strengths: ["Clear flow"], weaknesses: [], feedback: "Good", status: "completed" } });
  await prisma.report.create({ data: { interviewId, userId, mode: "SYSTEM_DESIGN", title: "URL shortener", score: 75, dimensions: {}, strengths: ["Clear flow"], weaknesses: [], feedback: "Good", summary: { repository: "URL shortener" }, completedAt: new Date() } });
  await prisma.interview.update({ where: { id: interviewId }, data: { status: "completed" } });
  await prisma.interviewCleanup.create({ data: { interviewId } });
  graph.fail = true;
  await reconcileInterviewCleanup();
  expect(await prisma.interview.findUnique({ where: { id: interviewId } })).not.toBeNull();
  expect(await prisma.interviewCleanup.findUnique({ where: { interviewId } })).not.toBeNull();
  graph.fail = false;
  await reconcileInterviewCleanup();
  expect(removedDesign).toContain(submissionId);
  expect(await prisma.interview.findUnique({ where: { id: interviewId } })).toBeNull();
  expect(await prisma.conversationTurn.count({ where: { interviewId } })).toBe(0);
  expect(await prisma.interviewCleanup.findUnique({ where: { interviewId } })).toBeNull();
  expect(await prisma.report.findUnique({ where: { interviewId } })).toMatchObject({ score: 75, userId });
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("userId", userId); await next(); });
  app.route("/api/v1/interviews", createResultsRouter());
  const result = await app.request(`/api/v1/interviews/${interviewId}/result`);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ status: "completed", score: 75 });
  const transcript = await app.request(`/api/v1/interviews/${interviewId}/transcript`);
  expect(transcript.status).toBe(410);
  const deleted = await app.request(`/api/v1/interviews/${interviewId}/report`, { method: "DELETE" });
  expect(deleted.status).toBe(204);
  expect(await prisma.report.findUnique({ where: { interviewId } })).toBeNull();
  await prisma.user.delete({ where: { id: userId } });
});

suite("evaluation commits an account-owned report before scheduling raw cleanup", async () => {
  setMemoryGraphStore(new FakeMemoryGraph());
  const userId = await createTestUser();
  const interviewId = `memory_eval_${randomUUID()}`;
  await prisma.interview.create({ data: {
    id: interviewId, userId, mode: "SYSTEM_DESIGN", status: "completing",
    systemDesignProblemId: "url-shortener", startedAt: new Date(Date.now() - 60_000),
  } });
  await prisma.interviewRuntime.create({ data: {
    interviewId, data: initialSystemDesignState({ problemId: "url-shortener", objectives: [] }) as never,
    deadlineAt: new Date(),
  } });
  const service = new EvaluationService({} as LlmClient);
  expect(await service.evaluateAndStore(interviewId)).toEqual({ status: "completed" });
  expect(await prisma.report.findUnique({ where: { interviewId } })).toMatchObject({
    userId, mode: "SYSTEM_DESIGN", score: null,
  });
  expect(await prisma.interviewCleanup.findUnique({ where: { interviewId } })).not.toBeNull();
  await expect(service.retry(interviewId)).rejects.toThrow("Report is final");
  await reconcileInterviewCleanup();
  expect(await prisma.interview.findUnique({ where: { id: interviewId } })).toBeNull();
  expect(await prisma.report.findUnique({ where: { interviewId } })).not.toBeNull();
  await prisma.user.delete({ where: { id: userId } });
});
