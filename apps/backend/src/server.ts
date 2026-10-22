import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig } from "./config.js";
import { LlmClient } from "./llm/llm.client.js";
import { InterviewService } from "./interview/interview.service.js";
import { createInterviewsRouter } from "./api/interviews.js";
import { SessionService } from "./realtime/session.service.js";
import { createSessionsRouter } from "./api/sessions.js";
import { EvaluationService } from "./evaluation/evaluation.service.js";
import { createCompletionRouter } from "./api/completion.js";
import { createResultsRouter } from "./api/results.js";
import { RealtimeEventService } from "./realtime/events.js";
import { createInternalRouter } from "./api/internal.js";
import { InterviewOrchestrator } from "./interview/orchestrator.js";
import { createAuthCapabilitiesRouter } from "./api/auth.js";
import {
  browserSessionMiddleware,
  interviewOwnership,
} from "./api/session.js";
import { createAuth } from "./auth/index.js";
import { clientIp } from "./api/client-ip.js";
import { JobWorker } from "./jobs/queue.js";
import { Queue } from "bullmq";
import { EvaluationRelay, EVALUATION_QUEUE } from "./jobs/evaluation-relay.js";
import { createRedisConnection } from "./jobs/redis.js";
import { exportTraces } from "./observability/events.js";
import { prisma } from "@repo/db";
import {
  createSystemDesignCatalogRouter,
  createSystemDesignInterviewRouter,
} from "./api/system-design.js";
import { configureDesignGraph } from "./system-design/graph.js";
import { requestCorrelation, serverError } from "./api/errors.js";

const config = loadConfig();
const auth = createAuth(config);

configureDesignGraph({
  host: config.FALKORDB_HOST,
  port: config.FALKORDB_PORT,
  graph: config.FALKORDB_GRAPH,
});

const llm = new LlmClient(config);
const interviewService = new InterviewService(llm);
const sessionService = new SessionService(config);
const evaluationService = new EvaluationService(llm);
const realtimeEvents = new RealtimeEventService();
const orchestrator = new InterviewOrchestrator(
  llm,
  config.INTERVIEW_DURATION_MINUTES,
  config.GITHUB_INTERVIEW_DURATION_MINUTES,
);

const worker = new JobWorker({
  PREPARE: (id) => interviewService.runPipeline(id),
  END: (id, payload) =>
    evaluationService.prepareFinalization(
      id,
      String(payload.reason ?? "completed"),
    ),
  ANALYZE: (id, payload) =>
    orchestrator.recoverAnalysis(id, String(payload.turnId)),
  VERIFY: (id, payload) =>
    orchestrator.verifyClaims(id, payload.claimIds as string[]),
});

// EVALUATE never runs in-process: the relay publishes durable PG intents to
// BullMQ and apps/evaluation-worker executes them.
const evaluationQueue = new Queue(EVALUATION_QUEUE, {
  connection: createRedisConnection(config.BULLMQ_REDIS_URL),
});
const evaluationRelay = new EvaluationRelay(evaluationQueue, (id) =>
  orchestrator.prepareEvaluation(id),
);

setInterval(() => {
  void worker
    .tick()
    .catch((err: unknown) => console.error("job worker failed", err));
}, 1000);
setInterval(() => {
  void evaluationRelay
    .tick()
    .catch((err: unknown) => console.error("evaluation relay failed", err));
}, 2000);
setInterval(() => {
  void evaluationService
    .finalizeExpired(config.RECONNECT_WINDOW_SECONDS)
    .catch((err: unknown) =>
      console.error("deadline finalization failed", err),
    );
  void exportTraces().catch((err: unknown) =>
    console.error("trace export failed", err),
  );
  void prisma.rateLimitBucket
    .deleteMany({ where: { resetAt: { lt: new Date() } } })
    .catch(() => {});
  void prisma.interviewSession
    .updateMany({
      where: {
        status: "active",
        disconnectedAt: null,
        heartbeatAt: { lt: new Date(Date.now() - 60_000) },
      },
      data: { disconnectedAt: new Date() },
    })
    .catch(() => {});
}, 10_000);

const app = new Hono();
app.use("*", requestCorrelation);
app.onError((error, c) => serverError(c, error));

app.use(
  "*",
  cors({
    origin: config.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()),
  }),
);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api/v1/auth", createAuthCapabilitiesRouter(config));
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const headers = new Headers(c.req.raw.headers);
  const ip = clientIp(
    c.req.raw,
    (c.env as { remoteAddress?: string } | undefined)?.remoteAddress,
    config.TRUSTED_PROXY_TOKEN,
  );
  headers.set("x-reporound-client-ip", ip);
  return auth.handler(new Request(c.req.raw, { headers }));
});

app.use("/api/v1/interviews", browserSessionMiddleware(auth));
app.use("/api/v1/interviews/:id", browserSessionMiddleware(auth));
app.use("/api/v1/interviews/:id/*", browserSessionMiddleware(auth));
app.use("/api/v1/system-design", browserSessionMiddleware(auth));
app.use("/api/v1/system-design/*", browserSessionMiddleware(auth));
app.use("/api/v1/interviews", interviewOwnership());
app.use("/api/v1/interviews/:id", interviewOwnership());
app.use("/api/v1/interviews/:id/*", interviewOwnership());

app.route("/api/v1/interviews", createInterviewsRouter(interviewService));
app.route("/api/v1/interviews", createSessionsRouter(sessionService));
app.route("/api/v1/interviews", createCompletionRouter(evaluationService));
app.route("/api/v1/interviews", createResultsRouter());
app.route("/api/v1/interviews", createSystemDesignInterviewRouter());
app.route("/api/v1/system-design", createSystemDesignCatalogRouter());
app.route(
  "/internal",
  createInternalRouter(config, realtimeEvents, orchestrator, evaluationService),
);

export const server = Bun.serve({
  port: config.PORT,
  fetch: (request, server) =>
    app.fetch(request, { remoteAddress: server.requestIP(request)?.address }),
});

console.log(`[backend] listening on http://localhost:${config.PORT}`);
console.log(`[backend] LLM model: ${config.AI_ROUTER_MODEL}`);
