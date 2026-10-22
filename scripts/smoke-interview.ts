import assert from "node:assert/strict";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Use a local backend configured with a disposable database. This smoke run
// allocates a real LiveKit session and grades generated test answers.
config({
  path: fileURLToPath(new URL("../apps/backend/.env", import.meta.url)),
});
const base = "http://localhost:8080";
const publicOrigin = "http://localhost:3000";
let cookie = "";
async function request(path: string, body?: unknown, internal = false) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(internal
        ? { Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}` }
        : { Cookie: cookie, Origin: publicOrigin }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return data;
}

function absorbCookies(headers: Headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") ?? ""];
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    if (!pair) continue;
    const name = pair.slice(0, pair.indexOf("="));
    cookie = cookie
      .split("; ")
      .filter((entry) => entry && entry.slice(0, entry.indexOf("=")) !== name)
      .concat(pair)
      .join("; ");
  }
}

assert.equal((await request("/health")).ok, true);

const email = `smoke-${Date.now()}@example.com`;
const password = "smoke-test-password-123";
const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: publicOrigin },
  body: JSON.stringify({ name: "Smoke Test", email, password }),
  signal: AbortSignal.timeout(30000),
});
assert(signUp.ok, `sign-up: HTTP ${signUp.status} ${await signUp.text()}`);
absorbCookies(signUp.headers);

const { prisma } = await import("@repo/db");
await prisma.user.update({ where: { email }, data: { emailVerified: true } });
const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: publicOrigin },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(30000),
});
assert(signIn.ok, `sign-in: HTTP ${signIn.status} ${await signIn.text()}`);
absorbCookies(signIn.headers);
assert(
  cookie.includes("reporound.session_token"),
  "sign-in must set a session cookie",
);
console.log("Created verified smoke account:", email);
const catalog = await request("/api/v1/system-design/problems");
const shortener = catalog.problems.find(
  (problem: { id: string }) => problem.id === "url-shortener",
);
assert(shortener);
assert.equal(typeof shortener.version, "number");
assert(shortener.loadAssumption.length > 0);
assert(shortener.constraints.length > 0);
const { interviewId } = await request("/api/v1/interviews", {
  mode: "SYSTEM_DESIGN",
  problemId: "url-shortener",
});
console.log("Created smoke interview:", interviewId);
const snapshot = {
  schemaVersion: 1,
  nodes: [
    {
      id: "api",
      position: { x: 0, y: 0 },
      data: { componentType: "api_service", label: "URL API" },
    },
    {
      id: "db",
      position: { x: 300, y: 0 },
      data: { componentType: "database", label: "URL Database" },
    },
  ],
  edges: [{ id: "api_db", source: "api", target: "db" }],
};
const payload = {
  requestId: crypto.randomUUID(),
  expectedRevision: 0,
  snapshot,
};
const submitted = await request(
  `/api/v1/interviews/${interviewId}/design/submissions`,
  payload,
);
const replay = await request(
  `/api/v1/interviews/${interviewId}/design/submissions`,
  payload,
);
assert.equal(submitted.submissionId, replay.submissionId);
assert.equal(submitted.revision, 1);
console.log("Architecture installed and idempotent replay verified");
const { sessionId } = await request(
  `/api/v1/interviews/${interviewId}/session`,
  {},
);
console.log("LiveKit session allocated");
let next = await request(
  `/internal/interviews/${interviewId}/start`,
  { sessionId },
  true,
);
assert.equal(next.ended, false);

const revisedSnapshot = {
  ...snapshot,
  nodes: [
    ...snapshot.nodes,
    {
      id: "cache",
      position: { x: 300, y: 200 },
      data: { componentType: "cache", label: "Redirect cache" },
    },
  ],
  edges: [
    ...snapshot.edges,
    { id: "api_cache", source: "api", target: "cache" },
  ],
};
const answers = [
  "The URL API validates the long URL and generates a random short code. A unique database constraint detects collisions, and we retry code generation on conflict. Redirect requests look up the original URL by code.",
  "Creating a link must commit before it is returned. I would use a primary database for writes and read from replicas only after handling replication lag. An immediate redirect can fall back to the primary if a replica misses a recently created code.",
  "A viral link can overwhelm database reads. I would cache the mapping with a TTL, coalesce concurrent cache misses, and add request limits. The original URL mapping remains durable in the database so the cache can be rebuilt.",
  "The redirect cache is on the read path, so a cache outage increases database read load but does not lose mappings. I would apply a request budget, keep cache lookups bounded by timeout, and fail open to the durable database path rather than reject redirects.",
  "For the failure scenario, I would protect against duplicate writes with the unique code constraint. During a database incident I would stop accepting new writes and serve existing redirects from cache and replicas. Recovery would rebuild the cache from durable rows rather than replay uncommitted requests.",
];
const seenQuestions = new Set<string>();
let revised = false;
let finalSeen = false;
for (let index = 0; index < 7 && !next.ended; index += 1) {
  assert(next.questionId, "question ID is required");
  assert(!seenQuestions.has(next.questionId), "question must not repeat");
  seenQuestions.add(next.questionId);
  const answer = answers[Math.min(index, answers.length - 1)]!;
  const response = await request(
    `/internal/interviews/${interviewId}/turns`,
    {
      sessionId,
      questionId: next.questionId,
      turnId: `smoke_${crypto.randomUUID()}`,
      text: answer,
    },
    true,
  );
  if (response.ended) {
    next = response;
    break;
  }
  const design = await request(`/api/v1/interviews/${interviewId}/design`);
  assert(design.checkpoint, "every answered diagram question opens a checkpoint");
  finalSeen = finalSeen || design.checkpoint.afterFailure;
  if (design.checkpoint.afterFailure) {
    const ended = await request(
      `/api/v1/interviews/${interviewId}/design/checkpoint`,
      { checkpointId: design.checkpoint.id, choice: "CONTINUE" },
    );
    assert.equal(ended.ended, true, "final checkpoint must end the interview");
    next = { ended: true };
    break;
  }
  if (!revised) {
    await request(`/api/v1/interviews/${interviewId}/design/checkpoint`, {
      checkpointId: design.checkpoint.id,
      choice: "EDIT",
    });
    const editable = await request(
      `/api/v1/interviews/${interviewId}/design`,
    );
    assert.equal(editable.revisionAllowed, true);
    const revisionPayload = {
      requestId: crypto.randomUUID(),
      expectedRevision: editable.activeRevision,
      snapshot: revisedSnapshot,
    };
    const revision = await request(
      `/api/v1/interviews/${interviewId}/design/submissions`,
      revisionPayload,
    );
    const revisionReplay = await request(
      `/api/v1/interviews/${interviewId}/design/submissions`,
      revisionPayload,
    );
    assert.equal(revision.revision, 2);
    assert.equal(revision.submissionId, revisionReplay.submissionId);
    assert.equal(revision.noChange, false);
    revised = true;
    console.log("Checkpoint revision published and replay verified");
  } else {
    await request(`/api/v1/interviews/${interviewId}/design/checkpoint`, {
      checkpointId: design.checkpoint.id,
      choice: "CONTINUE",
    });
  }
  const pending = await request(
    `/internal/interviews/${interviewId}/pending?sessionId=${sessionId}`,
    undefined,
    true,
  );
  assert.equal(pending.ended, false, "checkpoint should produce the next turn");
  next = {
    ended: false,
    questionId: pending.questionId,
    question: pending.question,
  };
}
assert(revised, "smoke flow must publish a checkpoint revision");
assert(finalSeen, "failure scenario must be the final substantive question");
const finalDesign = await request(`/api/v1/interviews/${interviewId}/design`);
assert(finalDesign.activeRevision >= 2);
console.log("Checkpoint flow, timer state, and final failure sequence verified");
await request(`/api/v1/interviews/${interviewId}/end`, {});
const deadline = Date.now() + 90000;
let result;
do {
  result = await request(`/api/v1/interviews/${interviewId}/result`);
  if (result.status === "completed" || result.status === "evaluation_failed")
    break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
} while (Date.now() < deadline);
assert.equal(
  result.status,
  "completed",
  "evaluation must finish through the queue worker",
);
console.log(
  "Evaluation completed:",
  JSON.stringify({
    status: result.status,
    score: result.score,
    candidateTurns: result.summary.candidateTurns,
  }),
);
await request("/api/auth/delete-user", { password });
await prisma.$disconnect();
console.log("Deleted smoke account and interview data");
