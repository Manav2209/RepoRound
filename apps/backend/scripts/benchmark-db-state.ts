import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { prisma } from "@repo/db";
import { InterviewOrchestrator } from "../src/interview/orchestrator.js";
import { initialState } from "../src/interview/schemas.js";
import { latencyStats } from "../src/observability/metrics.js";
import { LlmClient } from "../src/llm/llm.client.js";
import { loadConfig } from "../src/config.js";
import { activeSessions } from "../src/interview/active-sessions.js";
import { recordGithubQuestion } from "../src/interview/github-policy.js";

// The only writes are isolated fixtures owned by a new test account, deleted
// in finally. No LiveKit, queue publication or real interviews. Provider calls
// require the separate --live flag; ordinary runs use an immediate model stub.
if (!process.argv.includes("--configured-database"))
  throw new Error(
    "Pass --configured-database to create temporary benchmark fixtures",
  );
const output = resolve(
  process.env.BENCHMARK_OUTPUT ??
    "../../spec/benchmarks/db-state-controlled.json",
);
const userId = `db_bench_${crypto.randomUUID()}`;
const samples: number[] = [];
const eventCounts: number[] = [];
const queryCounts: number[] = [];
const callCounts: number[] = [];
const assessmentFailures: number[] = [];
const memoryMode = process.argv.includes("--memory");
const combined = process.argv.includes("--combined");
const live = process.argv.includes("--live");
const sampleCount = Number(
  process.argv.find((arg) => arg.startsWith("--samples="))?.split("=")[1] ?? 6,
);
if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 30)
  throw new Error("--samples must be between 1 and 30");
let observing = false,
  queries = 0,
  calls = 0;
if (process.env.DATABASE_QUERY_EVENTS === "1")
  prisma.$on(
    "query" as never,
    (() => {
      if (observing) queries++;
    }) as never,
  );
const stub = {
  async completeJson(messages: Array<{ content: string }>) {
    const assessment = {
      summary: "Explains the request flow",
      claims: [],
      evidence: [],
      objectiveSatisfied: false,
      answeredQuestion: true,
      explainedResponsibilities: true,
      identifiedTradeoffOrFailure: true,
      consistentWithEvidence: true,
      uncertainty: [],
      suggestedFollowUps: [],
      toolRequests: [],
    };
    const question = {
      introduction: "This project processes background jobs.",
      question:
        "Where does the request become durable before the worker acknowledges it?",
      referenceIndexes: [0],
    };
    if (messages[0]!.content.includes("Assess the candidate answer")) {
      const context = JSON.parse(messages[1]!.content);
      return {
        assessment,
        nextQuestion: {
          ...question,
          objectiveId:
            context.allowedObjectives.find(
              (item: { id: string }) => item.id !== context.currentObjective.id,
            )?.id ?? context.currentObjective.id,
        },
      };
    }
    return messages[0]!.content.includes("Extract only knowledge")
      ? assessment
      : question;
  },
} as unknown as LlmClient;
const provider = live ? new LlmClient(loadConfig()) : stub;
const llm = {
  async completeJson<T>(
    ...args: Parameters<LlmClient["completeJson"]>
  ): Promise<T> {
    calls++;
    return provider.completeJson<T>(...args);
  },
} as LlmClient;
await prisma.user.create({
  data: {
    id: userId,
    name: "DB state benchmark",
    email: `${userId}@example.test`,
    emailVerified: true,
  },
});
try {
  // Warm the pool outside the timed turn samples.
  await prisma.$queryRaw`SELECT 1`;
  for (let index = 0; index < sampleCount; index++) {
    const interviewId = `db_turn_${crypto.randomUUID()}`;
    const sessionId = `db_session_${crypto.randomUUID()}`;
    const state = initialState(
      [
        {
          id: "flow",
          kind: "REPOSITORY",
          phase: "ARCHITECTURE",
          topic: "Request durability",
          description: "Trace a request through the job queue",
          targetEvidence: ["Explains the durable acceptance boundary"],
          priority: "HIGH",
          status: "NOT_STARTED",
          attempts: 0,
          evidenceIds: [],
          sources: [{ path: "src/queue.ts" }],
        },
      ],
      "mid",
    );
    state.objectives[0]!.status = "IN_PROGRESS";
    recordGithubQuestion(state, state.objectives[0]!, false);
    state.questions.push({
      id: `q_${index}`,
      objectiveId: state.objectives[0]!.id,
      text: "Where does an accepted job become durable?",
      phase: state.objectives[0]!.phase,
      kind: state.objectives[0]!.kind,
      difficulty: "MEDIUM",
      reason: "NEW_TOPIC",
      askedAt: new Date().toISOString(),
    });
    await prisma.interview.create({
      data: {
        id: interviewId,
        userId,
        mode: "GITHUB",
        status: "active",
        owner: "fixture",
        name: "fixture",
        githubUrl: "https://github.com/fixture/fixture",
      },
    });
    await prisma.interviewRuntime.create({
      data: {
        interviewId,
        data: state as never,
        deadlineAt: new Date(Date.now() + 900_000),
      },
    });
    await prisma.interviewSession.create({
      data: {
        id: sessionId,
        interviewId,
        roomName: sessionId,
        serverUrl: "ws://benchmark.invalid",
        status: "active",
      },
    });
    await prisma.repositoryKnowledge.create({
      data: {
        interviewId,
        commitSha: "a".repeat(40),
        files: [
          {
            path: "src/queue.ts",
            content:
              "export function enqueue(job) { return durableQueue.add(job); }",
          },
        ],
        symbols: [],
        facts: { projectSummary: "An API that processes background jobs." },
      },
    });
    if (memoryMode) await activeSessions.activate(interviewId, sessionId);
    observing = true;
    queries = 0;
    calls = 0;
    const start = performance.now();
    const response = await new InterviewOrchestrator(llm, 30, 15, "current", {
      activeStorage: memoryMode ? "memory" : "postgres",
      githubTurnMode: combined ? "combined" : "separate",
    }).processTurn({
      interviewId,
      sessionId,
      turnId: `answer_${crypto.randomUUID()}`,
      questionId: `q_${index}`,
      text: "The API commits the job to the durable queue before returning a receipt. Workers acknowledge only after processing and deduplicate retries using the job identity.",
    });
    samples.push(performance.now() - start);
    observing = false;
    queryCounts.push(queries);
    callCounts.push(calls);
    if (response.ended)
      throw new Error("Fixture ended without a next question");
    const retained = memoryMode
      ? activeSessions.peek(interviewId)!.events
      : await prisma.interviewEvent.findMany({
          where: { interviewId },
          select: { type: true },
        });
    eventCounts.push(retained.length);
    assessmentFailures.push(
      retained.filter((event) => event.type === "analysis.failed").length,
    );
    activeSessions.evict(interviewId);
    console.log(
      `[db-benchmark] ${index + 1}/${sampleCount}: ${samples.at(-1)!.toFixed(1)} ms`,
    );
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        storage: memoryMode ? "memory" : "postgres",
        modelMode: live
          ? "configured live provider"
          : "deterministic zero-network stub",
        combined,
        methodology: `${sampleCount} sequential synthetic GitHub turns, warmed pool and a minimal repository fixture. Memory activation and fixture setup are outside the timed path. Includes answer processing/state/event handling; excludes completion flush, HTTP, voice and the intentional startup wait. No full interview or report is generated. Small diagnostic benchmark, not a production SLO or a live-voice comparison.`,
        samplesMs: samples,
        latency: latencyStats(samples),
        sqlQueriesPerTurn:
          process.env.DATABASE_QUERY_EVENTS === "1" ? queryCounts : null,
        modelCallsPerTurn: callCounts,
        assessmentFailures,
        retainedEventCounts: eventCounts,
      },
      null,
      2,
    ),
  );
  console.log(`[db-benchmark] saved ${output}`);
} finally {
  activeSessions.evictUser(userId);
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
}
