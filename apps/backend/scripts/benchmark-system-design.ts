import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@repo/db";
import type { ArchitectureSnapshot, ComponentKind } from "@repo/voice-types";
import { loadConfig } from "../src/config.js";
import { LlmClient } from "../src/llm/llm.client.js";
import { InterviewService } from "../src/interview/interview.service.js";
import { InterviewOrchestrator } from "../src/interview/orchestrator.js";
import { stateSchema } from "../src/interview/schemas.js";
import {
  configureDesignGraph,
  designGraphStore,
} from "../src/system-design/graph.js";
import {
  configureMemoryGraph,
  memoryGraphStore,
} from "../src/interview/memory-graph.js";
import { submitArchitecture } from "../src/system-design/submissions.js";
import { getProblem, problemSummaries } from "../src/system-design/problems.js";
import { EvaluationService } from "../src/evaluation/evaluation.service.js";
import { reconcileInterviewCleanup } from "../src/interview/cleanup.js";
import {
  readUserMetrics,
  snapshotInterviewMetrics,
} from "../src/observability/metrics.js";

// Deliberately refuses managed databases. Run from apps/backend, where Bun loads
// its existing .env for the live model; an explicit scratch DATABASE_URL wins.
const database = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  database.pathname !== "/rr_metrics"
)
  throw new Error("Benchmark requires the isolated local rr_metrics database");
if (!process.argv.includes("--live"))
  throw new Error("Pass --live to acknowledge real configured model calls");
const cfg = loadConfig();
const batch = `bench_${Date.now()}`;
configureDesignGraph({
  host: cfg.FALKORDB_HOST,
  port: cfg.FALKORDB_PORT,
  graph: `${batch}_design`,
});
configureMemoryGraph({
  host: cfg.FALKORDB_HOST,
  port: cfg.FALKORDB_PORT,
  graph: `${batch}_memory`,
});
const llm = new LlmClient(cfg);
const service = new InterviewService(llm);
const orchestrator = new InterviewOrchestrator(llm);
const evaluator = new EvaluationService(llm);
const output = resolve(
  process.env.BENCHMARK_OUTPUT ??
    "../../spec/benchmarks/system-design-controlled.json",
);
const only = process.argv
  .find((arg) => arg.startsWith("--problems="))
  ?.split("=")[1]
  ?.split(",");
const problems = problemSummaries().filter(
  (problem) => !only || only.includes(problem.id),
);
if (!problems.length) throw new Error("No benchmark problems selected");

const mechanisms: Record<string, [string, string]> = {
  "chat-application": [
    "Each conversation is assigned to one ordered partition. The writer assigns a monotonic sequence in a durable transaction before acknowledging. Clients display that sequence, buffer gaps, and fetch missing ranges. A client message ID has a uniqueness constraint so a retry returns the same stored message.",
    "Clients reconnect to another connection server with their last delivered conversation sequence. The durable store supplies missing messages. Client message IDs and sequence numbers suppress duplicate display. An unacknowledged send is retried with the same ID; an acknowledged message is already durable. Presence is temporary state.",
  ],
  "url-shortener": [
    "The mapping table owns a unique index on the generated code. A create uses an insert rather than an upsert. A collision returns a conflict and the caller generates a fresh random code and retries with a bounded budget. Existing mappings stay immutable and successful creation is acknowledged only after commit.",
    "The hot link is served from a bounded cache in front of the authoritative mapping store. A cache miss uses request coalescing so concurrent misses do not all hit storage. Replicas spread reads. A short TTL bounds stale data, although the mappings in this round are immutable. Monitor hit ratio and store latency.",
  ],
  "notification-system": [
    "The API stores a client request idempotency key with its payload hash under a unique constraint. A retry with the same key returns the original receipt; a changed payload is rejected. Work and its outbox entry commit together. The worker passes the same identity downstream where supported; provider-side exactly once is not assumed.",
    "During an SMS outage accepted work remains durable in the queue. Workers back off exponentially with jitter, cap attempts, and put permanent failures in a dead-letter queue. Recovery drains at the provider quota with bounded concurrency instead of releasing the entire backlog. Delivery state and provider receipts reduce duplicate effects without claiming impossible guarantees.",
  ],
  "rate-limiter": [
    "The API key selects one token bucket in shared state. An atomic operation refills using server time and subtracts only if a token is available. Concurrent requests serialize on that key. Local grants would need a bounded allocation and explicit overshoot tolerance. Return retry-after when the bucket is empty.",
    "If shared state is unavailable, sensitive expensive routes fail closed with a retryable response. Cheap routes may use a small local emergency quota, accepting a documented overshoot bound across servers. Circuit breaking and a bounded fallback protect downstream services. Monitoring distinguishes rejected traffic from coordination failures.",
  ],
  "file-storage": [
    "The client receives an upload identity and uploads numbered parts directly to object storage. Metadata records completed part checksums. On reconnect it requests the completed part list and retries only missing parts. Completion verifies all parts and atomically publishes a metadata version; incomplete uploads remain invisible and expire.",
    "A failed metadata publication leaves the object unreferenced. A reconciliation worker retries a versioned metadata commit idempotently; a retention window later removes abandoned objects. Downloads check authorization on the metadata record before issuing a short-lived object URL. Publication never exposes a partial object as a complete file.",
  ],
  "job-queue": [
    "A worker claims a job with an expiring lease and renews it while processing. Acknowledgment requires the current lease token. If a worker stops, the lease expires and the queue reoffers the job. Side effects use the job identity for idempotency because duplicate execution is possible. Retry attempts are bounded.",
    "A worker crash after an external side effect but before acknowledgment can redeliver the job. The receiver stores an idempotency record transactionally with its side effect where possible. Otherwise reconciliation and compensating actions are needed. A visibility timeout and lease renewal reduce premature retries but do not guarantee exactly-once execution.",
  ],
  "news-feed": [
    "Ordinary authors fan out a post ID to follower inboxes asynchronously. A high-follower author instead keeps a shared author stream and readers merge it at read time. Entries carry unique post IDs, ordering uses an agreed timestamp and tie breaker, and pagination uses a stable cursor. This trades read cost against write amplification.",
    "When fanout falls behind, durable post storage remains authoritative. Readers merge their inbox with recent author streams for a bounded freshness window, deduplicate by post ID, and receive a cursor. Queue lag triggers backpressure and bounded worker scaling. Eventual freshness is explicit; a successful post does not mean every inbox is already updated.",
  ],
  "ride-hailing": [
    "Nearby available drivers come from a geospatial index with recent locations. The match service conditionally changes one driver from available to reserved using a versioned compare-and-set. Offers have an expiry and a unique ride identity. Competing requests cannot both confirm the same current reservation. Expired reservations release capacity.",
    "If a driver disconnects during an offer, its reservation times out unless confirmed. The matching workflow records its version and retries another eligible driver. Late acceptance checks the same reservation token and cannot revive a superseded offer. Stale location entries expire, and confirmed assignments are durable independently of transient connections.",
  ],
  "video-streaming": [
    "The player fetches a manifest and chooses among pre-encoded bitrate variants based on throughput and buffer health. Segments are immutable objects delivered through a CDN. It switches at aligned segment boundaries and lowers bitrate before the buffer empties. Metadata tracks processing readiness so unfinished renditions are not advertised.",
    "A popular release fills CDN caches with immutable versioned segments. Cache misses are coalesced, origin requests are rate limited, and an origin shield reduces duplicate fetches. Multiple origins can serve durable media. If a rendition becomes slow, the player selects a lower available bitrate while preserving playback position.",
  ],
  "ticket-booking": [
    "A seat has one authoritative reservation record with a unique event and seat key. A transaction or conditional update moves it from available to held with an owner token and expiry. Competing holds lose the conditional change. Confirmation checks the same unexpired token, and payment requests carry a durable idempotency identity.",
    "If payment completes after a hold expires, a reconciliation workflow verifies the authoritative booking and payment identity. It confirms only if inventory is still owned, otherwise refunds or compensates rather than silently overselling. Timeouts remain pending until reconciled. Retried payment callbacks use the same identity and cannot duplicate confirmation.",
  ],
};

function fixture(): ArchitectureSnapshot {
  const nodes: [string, ComponentKind, string][] = [
    ["client", "client", "Client"],
    ["api", "api_service", "API and connection service"],
    ["db", "database", "Durable authoritative store"],
    ["cache", "cache", "Bounded cache"],
    ["queue", "message_queue", "Durable work queue"],
    ["worker", "worker", "Background worker"],
    ["object", "object_storage", "Object store"],
    ["cdn", "cdn", "CDN"],
    ["provider", "external_service", "Supplied provider"],
  ];
  const pairs = [
    ["client", "api"],
    ["api", "db"],
    ["api", "cache"],
    ["api", "queue"],
    ["queue", "worker"],
    ["worker", "db"],
    ["worker", "provider"],
    ["api", "object"],
    ["object", "cdn"],
    ["cdn", "client"],
  ];
  return {
    schemaVersion: 1,
    nodes: nodes.map(([id, componentType, label], i) => ({
      id,
      position: { x: i * 120, y: 0 },
      data: { componentType, label },
    })),
    edges: pairs.map(([source, target], i) => ({
      id: `edge${i}`,
      source: source!,
      target: target!,
    })),
  };
}

const userId = `benchmark_${crypto.randomUUID()}`;
const outcomes: Array<Record<string, unknown>> = [];
await prisma.user.create({
  data: {
    id: userId,
    name: "Controlled benchmark",
    email: `${userId}@example.test`,
    emailVerified: true,
  },
});
const started = new Date();
try {
  for (const catalog of problems) {
    let interviewId: string | undefined;
    const outcome: Record<string, unknown> = {
      problemId: catalog.id,
      completed: false,
      questionsAsked: 0,
      repeatPassed: false,
      silentCheckpoints: 0,
      rawCleanupPassed: false,
    };
    outcomes.push(outcome);
    try {
      const problem = getProblem(catalog.id)!;
      interviewId = (await service.createSystemDesign(problem.id, userId)).id;
      await submitArchitecture({
        interviewId,
        request: {
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          snapshot: fixture(),
        },
      });
      await prisma.interview.update({
        where: { id: interviewId },
        data: { status: "active", startedAt: new Date() },
      });
      const session = await prisma.interviewSession.create({
        data: {
          interviewId,
          roomName: `${batch}_${problem.id}`,
          serverUrl: "ws://benchmark.invalid",
          status: "active",
        },
      });
      let next = await orchestrator.start(interviewId, session.id);
      for (let index = 0; index < 3; index++) {
        if (next.ended)
          throw new Error("Ended before the three core questions");
        outcome.questionsAsked = index + 1;
        if (index === 1) {
          const before = await prisma.conversationTurn.count({
            where: { interviewId, role: "user" },
          });
          const repeated = await orchestrator.processTurn({
            interviewId,
            sessionId: session.id,
            turnId: `repeat_${crypto.randomUUID()}`,
            questionId: next.questionId,
            text: "Could you repeat the question please?",
          });
          outcome.repeatPassed =
            !repeated.ended &&
            repeated.questionId === next.questionId &&
            repeated.question === next.question &&
            before ===
              (await prisma.conversationTurn.count({
                where: { interviewId, role: "user" },
              }));
          if (!outcome.repeatPassed)
            throw new Error("Repeat request advanced or became an answer");
        }
        const answers = mechanisms[problem.id]!;
        const text =
          index === 0
            ? `The client sends the request to the API. The API validates it and commits the authoritative record to the durable store before confirming acceptance. A queue decouples background work, workers process it with retries, and a bounded cache speeds reads. These arrows describe a logical flow; the shared fixture contains optional blocks. ${answers[0]}`
            : answers[index - 1]!;
        const checkpoint = await orchestrator.processTurn({
          interviewId,
          sessionId: session.id,
          turnId: `answer_${crypto.randomUUID()}`,
          questionId: next.questionId,
          text,
        });
        if (
          checkpoint.ended ||
          checkpoint.speak !== false ||
          !checkpoint.checkpoint
        )
          throw new Error("Expected a silent UI checkpoint");
        outcome.silentCheckpoints = Number(outcome.silentCheckpoints) + 1;
        const runtime = await prisma.interviewRuntime.findUniqueOrThrow({
          where: { interviewId },
        });
        const state = stateSchema.parse(runtime.data);
        await orchestrator.resolveCheckpoint(
          interviewId,
          state.systemDesign!.checkpoint!.id,
          "CONTINUE",
        );
        next = await orchestrator.start(interviewId, session.id);
      }
      if (!next.ended)
        throw new Error("Round did not end after its third substantive answer");
      await evaluator.prepareFinalization(interviewId, "controlled_benchmark");
      await evaluator.evaluateAndStore(interviewId);
      outcome.reportProduced =
        (await prisma.report.count({ where: { interviewId } })) === 1;
      // Direct invocation replaces the job worker in this benchmark only.
      await prisma.interviewJob.updateMany({
        where: { interviewId },
        data: { status: "completed" },
      });
      await snapshotInterviewMetrics(interviewId);
      await reconcileInterviewCleanup();
      outcome.rawCleanupPassed =
        (await prisma.interview.findUnique({ where: { id: interviewId } })) ===
          null &&
        (await prisma.interviewMetrics.count({ where: { interviewId } })) === 1;
      outcome.completed = true;
      console.log(
        `[benchmark] ${problem.id}: 3 questions, repeat=${outcome.repeatPassed}, silent=${outcome.silentCheckpoints}, retention=${outcome.rawCleanupPassed}`,
      );
    } catch (error) {
      outcome.failure =
        error instanceof Error
          ? error.message.slice(0, 200)
          : "Unknown benchmark failure";
      if (interviewId) {
        await prisma.interview.updateMany({
          where: { id: interviewId },
          data: { status: "failed" },
        });
        await snapshotInterviewMetrics(interviewId);
      }
      console.error(`[benchmark] ${catalog.id}: ${outcome.failure}`);
    }
    await mkdir(resolve(output, ".."), { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        {
          schemaVersion: 1,
          startedAt: started.toISOString(),
          updatedAt: new Date().toISOString(),
          methodology: {
            kind: "controlled direct-backend benchmark with live configured model",
            model: cfg.AI_ROUTER_MODEL,
            scriptedCandidate: true,
            sharedSupersetDiagram: true,
            excludes: [
              "voice/STT/TTS",
              "browser/network round trip",
              "LiveKit dispatch",
              "BullMQ delivery",
              "human response/drawing time",
              "intentional 10-second startup wait",
            ],
            note: "Measures this development machine and provider at this time. Scripted answers and shared diagram test runtime contracts; scores do not measure human candidate quality. Small samples do not establish production SLOs.",
          },
          outcomes,
          metrics: await readUserMetrics(userId),
        },
        null,
        2,
      ),
    );
  }
} finally {
  for (const row of await prisma.interview.findMany({
    where: { userId },
    include: { designSubmissions: true },
  })) {
    for (const submission of row.designSubmissions)
      await designGraphStore().removeSubmission(submission.id);
    await memoryGraphStore().remove(row.id);
  }
  await prisma.user.delete({ where: { id: userId } });
  await designGraphStore().close();
  await memoryGraphStore().close?.();
  await prisma.$disconnect();
}
console.log(`[benchmark] Results saved to ${output}`);
if (outcomes.some((outcome) => !outcome.completed || !outcome.rawCleanupPassed))
  process.exitCode = 1;
