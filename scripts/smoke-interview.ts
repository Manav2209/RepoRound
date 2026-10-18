import assert from "node:assert/strict";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Use a local backend configured with a disposable database. This smoke run
// allocates a real LiveKit session and grades generated test answers.
config({
  path: fileURLToPath(new URL("../apps/backend/.env", import.meta.url)),
});
const base = "http://localhost:8080";
let token = "";
async function request(path: string, body?: unknown, internal = false) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${internal ? process.env.INTERNAL_API_TOKEN : token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return data;
}

assert.equal((await request("/health")).ok, true);
token = (await request("/api/v1/auth/session", {})).token;
const catalog = await request("/api/v1/system-design/problems");
assert(
  catalog.problems.some(
    (problem: { id: string }) => problem.id === "url-shortener",
  ),
);
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
const answers = [
  "The URL API validates the long URL and generates a random short code. A unique database constraint detects collisions, and we retry code generation on conflict. Redirect requests look up the original URL by code.",
  "Creating a link must commit before it is returned. I would use a primary database for writes and read from replicas only after handling replication lag. An immediate redirect can fall back to the primary if a replica misses a recently created code.",
  "A viral link can overwhelm database reads. I would cache the mapping with a TTL, coalesce concurrent cache misses, and add request limits. The original URL mapping remains durable in the database so the cache can be rebuilt.",
];
for (const text of answers) {
  assert.equal(next.ended, false);
  next = await request(
    `/internal/interviews/${interviewId}/turns`,
    {
      sessionId,
      questionId: next.questionId,
      turnId: `smoke_${crypto.randomUUID()}`,
      text,
    },
    true,
  );
}
const design = await request(`/api/v1/interviews/${interviewId}/design`);
assert.equal(
  design.revisionAllowed,
  true,
  "minimal diagram must reach the challenge",
);
console.log("Minimal architecture reached its revision challenge");
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
