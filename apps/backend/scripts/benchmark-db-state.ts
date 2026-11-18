import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { prisma } from "@repo/db";
import { InterviewOrchestrator } from "../src/interview/orchestrator.js";
import { initialState } from "../src/interview/schemas.js";
import { latencyStats } from "../src/observability/metrics.js";
import type { LlmClient } from "../src/llm/llm.client.js";

// The only writes are isolated fixtures owned by a new test account, deleted
// in finally. No LiveKit, queue publication, provider calls, or real interviews.
if (!process.argv.includes("--configured-database"))
  throw new Error("Pass --configured-database to create temporary benchmark fixtures");
const output = resolve(process.env.BENCHMARK_OUTPUT ?? "../../spec/benchmarks/db-state-controlled.json");
const userId = `db_bench_${crypto.randomUUID()}`;
const samples: number[] = [];
const eventCounts: number[] = [];
const llm = {
  async completeJson(messages: Array<{ content: string }>) {
    return messages[0]!.content.includes("Extract only knowledge")
      ? { summary: "Explains the request flow", claims: [], evidence: [], objectiveSatisfied: false, answeredQuestion: true, explainedResponsibilities: true, identifiedTradeoffOrFailure: true, consistentWithEvidence: true, uncertainty: [], suggestedFollowUps: [], toolRequests: [] }
      : { introduction: "This project processes background jobs.", question: "Where does the request become durable before the worker acknowledges it?", referenceIndexes: [0] };
  },
} as unknown as LlmClient;
await prisma.user.create({ data: { id: userId, name: "DB state benchmark", email: `${userId}@example.test`, emailVerified: true } });
try {
  // Warm the pool outside the timed turn samples.
  await prisma.$queryRaw`SELECT 1`;
  for (let index = 0; index < 6; index++) {
    const interviewId = `db_turn_${crypto.randomUUID()}`;
    const sessionId = `db_session_${crypto.randomUUID()}`;
    const state = initialState([{ id: "flow", kind: "REPOSITORY", phase: "ARCHITECTURE", topic: "Request durability", description: "Trace a request through the job queue", targetEvidence: ["Explains the durable acceptance boundary"], priority: "HIGH", status: "NOT_STARTED", attempts: 0, evidenceIds: [], sources: [{ path: "src/queue.ts" }] }], "mid");
    state.questions.push({ id: `q_${index}`, objectiveId: state.objectives[0]!.id, text: "Where does an accepted job become durable?", phase: state.objectives[0]!.phase, kind: state.objectives[0]!.kind, difficulty: "MEDIUM", reason: "NEW_TOPIC", askedAt: new Date().toISOString() });
    await prisma.interview.create({ data: { id: interviewId, userId, mode: "GITHUB", status: "active", owner: "fixture", name: "fixture", githubUrl: "https://github.com/fixture/fixture" } });
    await prisma.interviewRuntime.create({ data: { interviewId, data: state as never, deadlineAt: new Date(Date.now() + 900_000) } });
    await prisma.interviewSession.create({ data: { id: sessionId, interviewId, roomName: sessionId, serverUrl: "ws://benchmark.invalid", status: "active" } });
    await prisma.repositoryKnowledge.create({ data: { interviewId, commitSha: "a".repeat(40), files: [{ path: "src/queue.ts", content: "export function enqueue(job) { return durableQueue.add(job); }" }], symbols: [], facts: { projectSummary: "An API that processes background jobs." } } });
    const start = performance.now();
    const response = await new InterviewOrchestrator(llm).processTurn({ interviewId, sessionId, turnId: `answer_${crypto.randomUUID()}`, questionId: `q_${index}`, text: "The API commits the job to the durable queue before returning a receipt. Workers acknowledge only after processing and deduplicate retries using the job identity." });
    samples.push(performance.now() - start);
    if (response.ended) throw new Error("Fixture ended without a next question");
    eventCounts.push(await prisma.interviewEvent.count({ where: { interviewId } }));
    console.log(`[db-benchmark] ${index + 1}/6: ${samples.at(-1)!.toFixed(1)} ms`);
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), methodology: "Six sequential synthetic GitHub turns against the configured database, warmed pool, deterministic zero-network model stub, minimal repository fixture. Includes lock/read/state/event persistence; excludes fixture setup, HTTP, voice, real model latency and the intentional startup wait. Small diagnostic benchmark, not a production SLO or a live-interview comparison.", samplesMs: samples, latency: latencyStats(samples), retainedEventCounts: eventCounts }, null, 2));
  console.log(`[db-benchmark] saved ${output}`);
} finally {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
}
