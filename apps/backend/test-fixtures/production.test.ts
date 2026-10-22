// Regression coverage at the production route/service boundary; no live services.
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Prisma } from "../../../packages/db/generated/client/index.js";
import { Hono } from "hono";
import { clientIp } from "../src/api/client-ip.js";
import { requestCorrelation } from "../src/api/errors.js";
import { selectEvaluationTurns } from "../src/evaluation/transcript.js";

const restores: Array<() => void> = [];
let db: any;
const isolatedDb = new Proxy(
  {},
  {
    get: (_, key) => {
      if (!(key in db))
        throw new Error(`Unconfigured database access: ${String(key)}`);
      return db[key];
    },
  },
);
mock.module(
  fileURLToPath(new URL("../../../packages/db/src/index.ts", import.meta.url)),
  () => ({ prisma: isolatedDb, Prisma }),
);

const { browserSessionMiddleware, interviewOwnership } =
  await import("../src/api/session.js");
const { createSystemDesignCatalogRouter, createSystemDesignInterviewRouter } =
  await import("../src/api/system-design.js");
const { createSessionsRouter } = await import("../src/api/sessions.js");
const { createInterviewsRouter } = await import("../src/api/interviews.js");
const { submitArchitecture, snapshotHash } =
  await import("../src/system-design/submissions.js");
const { normalizeSnapshot } =
  await import("../src/system-design/validation.js");
const { setDesignGraphStore } = await import("../src/system-design/graph.js");
const { JobWorker, JobDeferred } = await import("../src/jobs/queue.js");
const { EvaluationService } =
  await import("../src/evaluation/evaluation.service.js");
const { Evaluator, emptyEvaluation } =
  await import("../src/evaluation/evaluator.js");

beforeEach(() => {
  db = {};
});
afterEach(() => {
  while (restores.length) restores.pop()!();
  setDesignGraphStore(null);
});
const snapshot = () =>
  ({
    schemaVersion: 1,
    nodes: [
      {
        id: "web",
        position: { x: 0, y: 0 },
        data: { componentType: "client", label: "Web" },
      },
      {
        id: "api",
        position: { x: 200, y: 0 },
        data: { componentType: "api_service", label: "API" },
      },
    ],
    edges: [{ id: "e1", source: "web", target: "api" }],
  }) as any;
const state = () => ({
  phase: "FINAL",
  difficulty: "MEDIUM",
  objectives: [],
  claims: [],
  evidence: [],
  questions: [],
  processedTurns: {},
  ended: true,
});

function authFixture() {
  const buckets = new Map<string, number>();
  let ownershipLookups = 0;
  db.rateLimitBucket = {
    upsert: async ({ where }: any) => {
      const count = (buckets.get(where.id) ?? 0) + 1;
      buckets.set(where.id, count);
      return { count };
    },
  };
  db.interview = {
    findFirst: async ({ where }: any) => {
      ownershipLookups++;
      return where.id === "mine" && where.userId === "user-1"
        ? { id: "mine" }
        : null;
    },
  };
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const token = headers
          .get("cookie")
          ?.split(";")
          .map((part) => part.trim().split("="))
          .find(([name]) => name?.endsWith("session_token"))?.[1];
        if (token === "unverified") {
          return {
            session: { id: "s2" },
            user: {
              id: "user-2",
              email: "unverified@example.com",
              emailVerified: false,
            },
          };
        }
        if (token !== "valid") return null;
        return {
          session: { id: "s1" },
          user: {
            id: "user-1",
            email: "user@example.com",
            emailVerified: true,
          },
        };
      },
    },
  };
  const app = new Hono();
  app.use("/api/v1/interviews", browserSessionMiddleware(auth as any));
  app.use("/api/v1/interviews/:id", browserSessionMiddleware(auth as any));
  app.use("/api/v1/interviews/:id/*", browserSessionMiddleware(auth as any));
  app.use("/api/v1/system-design", browserSessionMiddleware(auth as any));
  app.use("/api/v1/system-design/*", browserSessionMiddleware(auth as any));
  app.use("/api/v1/interviews", interviewOwnership());
  app.use("/api/v1/interviews/:id", interviewOwnership());
  app.use("/api/v1/interviews/:id/*", interviewOwnership());
  app.route("/api/v1/system-design", createSystemDesignCatalogRouter());
  app.post("/api/v1/interviews", (c: any) => c.json({ ok: true }, 201));
  app.get("/api/v1/interviews/:id", (c: any) => c.json({ ok: true }));
  app.post("/api/v1/interviews/:id/design/submissions", (c: any) =>
    c.json({ ok: true }),
  );
  return {
    app,
    buckets,
    get ownershipLookups() {
      return ownershipLookups;
    },
  };
}
const sessionHeaders = (token = "valid") => ({
  Cookie: `reporound.session_token=${token}`,
});

test("real catalog router accepts a verified production session without owner lookup", async () => {
  const fixture = authFixture();
  const res = await fixture.app.request("/api/v1/system-design/problems", {
    headers: sessionHeaders(),
  });
  expect(res.status).toBe(200);
  expect((await res.json()).problems.length).toBeGreaterThan(0);
  expect(fixture.ownershipLookups).toBe(0);
});

test("session controls: missing, invalid, and unverified sessions are rejected", async () => {
  const { app } = authFixture();
  expect((await app.request("/api/v1/system-design/problems")).status).toBe(
    401,
  );
  expect(
    (
      await app.request("/api/v1/system-design/problems", {
        headers: sessionHeaders("invalid"),
      })
    ).status,
  ).toBe(401);
  const unverified = await app.request("/api/v1/system-design/problems", {
    headers: sessionHeaders("unverified"),
  });
  expect(unverified.status).toBe(403);
  expect((await unverified.json()).code).toBe("EMAIL_NOT_VERIFIED");
});

test("ownership controls: owner allowed; another user's read and write rejected", async () => {
  const { app } = authFixture();
  const headers = sessionHeaders();
  expect(
    (await app.request("/api/v1/interviews/mine", { headers })).status,
  ).toBe(200);
  expect(
    (await app.request("/api/v1/interviews/other", { headers })).status,
  ).toBe(404);
  expect(
    (
      await app.request("/api/v1/interviews/other/design/submissions", {
        method: "POST",
        headers,
      })
    ).status,
  ).toBe(404);
});

test("interview creation is rate limited per authenticated account", async () => {
  const fixture = authFixture();
  const clock = spyOn(Date, "now").mockReturnValue(1792454400000);
  restores.push(() => clock.mockRestore());
  const statuses: number[] = [];
  for (let n = 0; n < 11; n++) {
    const res = await fixture.app.request("/api/v1/interviews", {
      method: "POST",
      headers: sessionHeaders(),
    });
    statuses.push(res.status);
  }
  expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
  expect(statuses[10]).toBe(429);
  expect(fixture.buckets.size).toBe(1);
});

test("invalid trusted client addresses fall back to normalized peer identity", () => {
  const token = "a".repeat(64);
  const req = new Request("https://example.com", {
    headers: {
      "X-RepoRound-Client-IP": "1.2.3.4, 5.6.7.8",
      "X-RepoRound-Proxy-Token": token,
    },
  });
  expect(clientIp(req, "::ffff:127.0.0.1", token)).toBe("127.0.0.1");
  expect(clientIp(req, "not-an-ip", token)).toBe("unknown");
});

function publicationFixture(lockBusy: boolean) {
  const snap = snapshot();
  const submissions: any[] = [];
  const runtime: any = {
    version: 0,
    data: {
      ...state(),
      phase: "ARCHITECTURE",
      ended: false,
      systemDesign: {
        problemId: "notification-system",
        phase: "REVISION_REQUESTED",
        activeRevision: 1,
        activeSubmissionId: "revision-1",
        challengeIssued: true,
        revisionSubmitted: false,
        probesAsked: [],
        selectedProbeIds: [],
      },
    },
  };
  let busy = lockBusy;
  let claims = 0;
  let failCommit = false;
  const prior = {
    id: "revision-1",
    interviewId: "i1",
    revision: 1,
    graphStatus: "READY",
    snapshot: {
      ...snap,
      nodes: snap.nodes.map((node: any, index: number) =>
        index === 0
          ? { ...node, data: { ...node.data, label: "Prior web client" } }
          : node,
      ),
    },
    createdAt: new Date(),
  };
  db.interview = {
    findUnique: async () => ({ id: "i1", mode: "SYSTEM_DESIGN" }),
  };
  db.systemDesignSubmission = {
    findUnique: async ({ where }: any) =>
      submissions.find((s) => s.requestId === where.requestId) ?? null,
    findFirst: async () =>
      [...submissions, prior]
        .filter((s) => s.graphStatus === "READY")
        .sort((a, b) => b.revision - a.revision)[0],
    create: async ({ data }: any) => {
      const row = { ...data, createdAt: new Date() };
      submissions.push(row);
      return structuredClone(row);
    },
    findUniqueOrThrow: async ({ where }: any) =>
      structuredClone(submissions.find((s) => s.id === where.id)),
    updateMany: async ({ where, data }: any) => {
      Object.assign(
        submissions.find((s) => s.id === where.id),
        data,
      );
      return { count: 1 };
    },
  };
  db.interviewRuntime = {
    findUnique: async () => structuredClone(runtime),
    findUniqueOrThrow: async () => structuredClone(runtime),
    updateMany: async ({ where, data }: any) => {
      if (where.OR) {
        claims++;
        return { count: busy ? 0 : 1 };
      }
      if (data.data) {
        runtime.data = data.data;
        runtime.version++;
      }
      return { count: 1 };
    },
  };
  db.$transaction = async (fn: any) => {
    const beforeRuntime = structuredClone(runtime);
    const beforeSubmissions = structuredClone(submissions);
    try {
      const result = await fn(isolatedDb);
      if (failCommit) {
        failCommit = false;
        throw new Error("injected commit failure");
      }
      return result;
    } catch (error) {
      Object.assign(runtime, beforeRuntime);
      submissions.splice(0, submissions.length, ...beforeSubmissions);
      throw error;
    }
  };
  setDesignGraphStore({
    install: async () => {},
    verify: async () => ({
      nodeCount: 2,
      edgeCount: 1,
      crossSubmissionEdges: 0,
    }),
  } as any);
  return {
    runtime,
    submissions,
    prior,
    request: {
      requestId: "dc90a706-0f83-4c21-8506-e3e001b39e01",
      expectedRevision: 1,
      snapshot: snap,
    },
    release: () => {
      busy = false;
    },
    failNextCommit: () => {
      failCommit = true;
    },
    get claims() {
      return claims;
    },
  };
}

test("a concurrent request ID collision cannot publish another interview's submission", async () => {
  const f = publicationFixture(false);
  db.systemDesignSubmission.create = async () => {
    throw new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
  };
  const priorFind = db.systemDesignSubmission.findFirst;
  db.systemDesignSubmission.findFirst = async (args: any) =>
    args.where.OR
      ? {
          id: "foreign-submission",
          interviewId: "another-interview",
          requestId: f.request.requestId,
          snapshotHash: snapshotHash(f.request.snapshot),
          revision: 2,
          graphStatus: "READY",
        }
      : priorFind(args);
  await expect(
    submitArchitecture({ interviewId: "i1", request: f.request }),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.claims).toBe(0);
  expect(f.runtime.data.systemDesign.activeRevision).toBe(1);
});

test("publication contention leaves a failed revision; the same request recovers and publishes", async () => {
  const f = publicationFixture(true);
  await expect(
    submitArchitecture({ interviewId: "i1", request: f.request }),
  ).rejects.toThrow("Interview is busy");
  expect(f.submissions[0].graphStatus).toBe("FAILED");
  expect(f.runtime.data.systemDesign.activeRevision).toBe(1);
  f.release();
  const replay = await submitArchitecture({
    interviewId: "i1",
    request: f.request,
  });
  expect(replay.replayed).toBe(true);
  expect(replay.revision).toBe(2);
  expect(f.runtime.data.systemDesign.activeRevision).toBe(2);
  expect(f.runtime.data.systemDesign.revisionSubmitted).toBe(true);
  expect(f.submissions[0].graphStatus).toBe("READY");
  expect(f.claims).toBe(2);
});

test("READY replays repair legacy unpublished revisions and never downgrade a newer revision", async () => {
  const f = publicationFixture(true);
  await expect(
    submitArchitecture({ interviewId: "i1", request: f.request }),
  ).rejects.toThrow();
  f.submissions[0].graphStatus = "READY";
  await expect(
    submitArchitecture({ interviewId: "i1", request: f.request }),
  ).rejects.toMatchObject({ status: 503 });
  f.release();
  await submitArchitecture({ interviewId: "i1", request: f.request });
  expect(f.runtime.data.systemDesign.activeRevision).toBe(2);
  f.runtime.data.systemDesign.activeRevision = 3;
  await submitArchitecture({ interviewId: "i1", request: f.request });
  expect(f.runtime.data.systemDesign.activeRevision).toBe(3);
});

test("publication transaction failure rolls back both runtime and READY before retry", async () => {
  const f = publicationFixture(false);
  f.failNextCommit();
  await expect(
    submitArchitecture({ interviewId: "i1", request: f.request }),
  ).rejects.toMatchObject({ status: 503 });
  expect(f.submissions[0].graphStatus).toBe("FAILED");
  expect(f.runtime.data.systemDesign.activeRevision).toBe(1);
  await submitArchitecture({ interviewId: "i1", request: f.request });
  expect(f.submissions[0].graphStatus).toBe("READY");
  expect(f.runtime.data.systemDesign.activeRevision).toBe(2);
});

test("publication control: absent lease contention, revision 2 is published", async () => {
  const f = publicationFixture(false);
  const result = await submitArchitecture({
    interviewId: "i1",
    request: f.request,
  });
  expect(result.revision).toBe(2);
  expect(f.runtime.data.systemDesign.activeRevision).toBe(2);
  expect(f.runtime.data.systemDesign.revisionSubmitted).toBe(true);
});

test("no-op checkpoint submission returns noChange without a new revision or lock", async () => {
  const f = publicationFixture(false);
  f.prior.snapshot = structuredClone(f.request.snapshot);
  const result = await submitArchitecture({
    interviewId: "i1",
    request: f.request,
  });
  expect(result).toMatchObject({
    revision: 1,
    noChange: true,
    replayed: false,
  });
  expect(f.claims).toBe(0);
  expect(f.submissions).toEqual([]);
  expect(f.runtime.data.systemDesign.activeRevision).toBe(1);
});

test("P2 as reported rejected: parallel edges have unequal hashes but public API rejects both as invalid", async () => {
  const snap = snapshot();
  snap.edges.push({ id: "e2", source: "web", target: "api" });
  const shuffled = { ...snap, edges: [...snap.edges].reverse() };
  expect(snapshotHash(snap)).not.toBe(snapshotHash(shuffled));
  expect(() => normalizeSnapshot(snap)).toThrow("Duplicate edge");
  const app = createSystemDesignInterviewRouter({} as never);
  for (const input of [snap, shuffled]) {
    const res = await app.request("/i1/design/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: "dc90a706-0f83-4c21-8506-e3e001b39e01",
        expectedRevision: 0,
        snapshot: input,
      }),
    });
    expect(res.status).toBe(422);
  }
});

test("node-array order remains part of the existing immutable snapshot contract", async () => {
  const first = normalizeSnapshot(snapshot());
  const reordered = normalizeSnapshot({
    ...first,
    nodes: [...first.nodes].reverse(),
  });
  expect(snapshotHash(first)).not.toBe(snapshotHash(reordered));
  db.interview = {
    findUnique: async () => ({ id: "i1", mode: "SYSTEM_DESIGN" }),
  };
  db.systemDesignSubmission = {
    findUnique: async () => ({
      id: "s1",
      interviewId: "i1",
      revision: 1,
      graphStatus: "READY",
      snapshotHash: snapshotHash(first),
    }),
  };
  await expect(
    submitArchitecture({
      interviewId: "i1",
      request: {
        requestId: "dc90a706-0f83-4c21-8506-e3e001b39e01",
        expectedRevision: 0,
        snapshot: reordered,
      },
    }),
  ).rejects.toThrow("different submission");
});

test("hash control: reordering distinct valid edges preserves hash", () => {
  const snap = snapshot();
  snap.nodes.push({
    id: "db",
    position: { x: 400, y: 0 },
    data: { componentType: "database", label: "DB" },
  });
  snap.edges.push({ id: "e2", source: "api", target: "db" });
  const a = normalizeSnapshot(snap);
  const b = normalizeSnapshot({ ...snap, edges: [...snap.edges].reverse() });
  expect(snapshotHash(a)).toBe(snapshotHash(b));
});

test("deferral does not spend an attempt; persistent failures stop after four executions", async () => {
  const row: any = {
    id: "job1",
    interviewId: "i1",
    kind: "PREPARE",
    payload: {},
    status: "pending",
    attempts: 0,
    runAt: new Date(0),
  };
  db.interviewJob = {
    findMany: async () =>
      row.status === "failed" ? [] : [structuredClone(row)],
    findUniqueOrThrow: async () => ({ attempts: row.attempts }),
    updateMany: async ({ data }: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (key === "attempts")
          row.attempts += (value as any).increment ?? -(value as any).decrement;
        else row[key] = value;
      }
      return { count: 1 };
    },
  };
  db.$transaction = async (fn: any) => fn(isolatedDb);
  db.interview = { updateMany: async () => ({ count: 1 }) };
  let executions = 0;
  let defer = true;
  const worker = new JobWorker({
    PREPARE: async () => {
      if (defer) throw new JobDeferred();
      executions++;
      throw new Error("synthetic persistent failure");
    },
  });
  await worker.tick();
  expect(row.attempts).toBe(0);
  expect(row.status).toBe("pending");
  defer = false;
  for (let n = 0; n < 4; n++) await worker.tick();
  expect(executions).toBe(4);
  expect(row.status).toBe("failed");
  await worker.tick();
  expect(executions).toBe(4);
  expect(row.attempts).toBe(4);
});

async function evaluationPayload(turns: any[], evidence: any[] = []) {
  const data = { ...state(), evidence };
  let query: any;
  let payload: any;
  db.evaluation = { findUnique: async () => null, upsert: async () => ({}) };
  db.interview = {
    findUniqueOrThrow: async () => ({
      id: "i1",
      mode: "GITHUB",
      status: "completing",
      runtime: { data },
      knowledge: null,
      interviewPlan: null,
    }),
    update: async () => ({}),
  };
  db.interviewRuntime = {
    updateMany: async () => ({ count: 1 }),
    update: async () => ({}),
  };
  db.interviewEvent = { create: async () => ({}) };
  db.conversationTurn = {
    findMany: async (args: any) => {
      query ??= args;
      const sorted = [...turns].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );
      const start = args.cursor
        ? sorted.findIndex((t) => t.id === args.cursor.id) + args.skip
        : 0;
      return sorted.slice(start, start + (args.take ?? turns.length));
    },
  };
  db.$transaction = async (fn: any) => fn(isolatedDb);
  const spy = spyOn(Evaluator.prototype, "evaluate").mockImplementation(
    async (ctx: any) => {
      payload = ctx;
      return emptyEvaluation();
    },
  );
  restores.push(() => spy.mockRestore());
  await new EvaluationService({} as any).evaluateAndStore("i1");
  return { query, payload };
}
const turn = (n: number, text: string, role = "user") => ({
  id: `turn-${String(n).padStart(3, "0")}`,
  text,
  role,
  questionId: `q${n}`,
  analysisStatus: "completed",
  createdAt: new Date(n * 1000),
});

test("evaluation paginates beyond 100 turns and retains later candidate evidence", async () => {
  const turns = Array.from({ length: 101 }, (_, i) =>
    turn(
      i,
      i === 100 ? "UNIQUE_LATE_STRONG_ANSWER" : "earlier response",
      i % 2 ? "assistant" : "user",
    ),
  );
  const lateEvidence = {
    id: "ev-late",
    objectiveId: "o1",
    skill: "architecture",
    topic: "consistency",
    evidence: "UNIQUE_LATE_STRONG_ANSWER",
    strength: "STRONG",
    sourceTurnId: turns[100]!.id,
    confidence: 0.9,
  };
  const { query, payload } = await evaluationPayload(turns, [lateEvidence]);
  expect(query.take).toBe(100);
  expect(query.orderBy[0]).toEqual({ createdAt: "asc" });
  expect(payload.transcript).toHaveLength(101);
  expect(JSON.stringify(payload)).toContain("UNIQUE_LATE_STRONG_ANSWER");
  expect(payload.candidateEvidence).toHaveLength(1);
});

test("evaluation service passes all answers to explicit model-budget selection", async () => {
  const turns = Array.from({ length: 21 }, (_, i) =>
    turn(i, i === 20 ? "UNIQUE_FINAL_DESIGN_REASONING" : "x".repeat(2000)),
  );
  const { payload } = await evaluationPayload(turns);
  expect(payload.transcript).toHaveLength(21);
  const selected = selectEvaluationTurns(payload.transcript, [], 32000);
  expect(selected.turns).toHaveLength(21);
  expect(JSON.stringify(selected.turns)).toContain(
    "UNIQUE_FINAL_DESIGN_REASONING",
  );
  expect(selected.coverage.quality).toBe("partial");
  expect(selected.coverage.truncatedTurns).toBeGreaterThan(0);
});

test("evaluation control: short interview retains final answer", async () => {
  const { payload } = await evaluationPayload([
    turn(0, "early"),
    turn(1, "FINAL_ANSWER"),
  ]);
  expect(payload.transcript).toHaveLength(2);
  expect(payload.transcript[1].text).toBe("FINAL_ANSWER");
});

test("unexpected session and interview errors are generic and correlated", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  restores.push(() => log.mockRestore());
  const marker = "SYNTHETIC_PRIVATE_PROVIDER_CONFIGURATION";
  const sessionApp = createSessionsRouter({
    startForInterview: async () => {
      throw new Error(marker);
    },
  } as any);
  const session = await sessionApp.request("/i1/session", { method: "POST" });
  expect(session.status).toBe(500);
  const sessionBody = await session.json();
  expect(sessionBody.error).toBe("Internal error");
  expect(sessionBody.requestId).toBe(session.headers.get("X-Request-Id"));
  const interviewApp = createInterviewsRouter({
    create: async () => {
      throw new Error(marker);
    },
  } as any);
  const interview = await interviewApp.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ githubUrl: "https://github.com/example/repo" }),
  });
  expect(interview.status).toBe(500);
  const interviewBody = await interview.json();
  expect(interviewBody.error).toBe("Internal error");
  expect(JSON.stringify(interviewBody)).not.toContain(marker);
  expect(log).toHaveBeenCalledTimes(2);
});

test("correlation middleware assigns a server-generated ID instead of trusting the caller", async () => {
  const app = new Hono();
  app.use("*", requestCorrelation);
  app.get("/", (c) => c.json({ requestId: c.get("requestId") }));
  const res = await app.request("/", {
    headers: { "X-Request-Id": "untrusted" },
  });
  const body = await res.json();
  expect(body.requestId).toBe(res.headers.get("X-Request-Id"));
  expect(body.requestId).not.toBe("untrusted");
});
