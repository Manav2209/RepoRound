import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the existing backend dependency both in the checkout and in its image.
const { parse } = createRequire(
  new URL("../../apps/backend/package.json", import.meta.url),
)("dotenv");

function requireValues(env, keys, label) {
  for (const key of keys) {
    if (!env[key]?.trim()) throw new Error(`${label}: ${key} is required`);
  }
}

function requireUrl(value, key, protocols) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(`${key} uses an unsupported URL protocol`);
  }
  return url;
}

export function prepareEnv(backendText, voiceText, publicOrigin, workerText) {
  const origin = requireUrl(publicOrigin, "PUBLIC_ORIGIN", ["https:"]);
  if (origin.origin !== publicOrigin || origin.username || origin.password) {
    throw new Error(
      "PUBLIC_ORIGIN must be an HTTPS origin without a path or credentials",
    );
  }
  const backend = parse(backendText);
  const voice = parse(voiceText);
  const worker = workerText === undefined ? null : parse(workerText);
  const shared = [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "AI_ROUTER_BASE_URL",
    "AI_ROUTER_API_KEY",
    "AI_ROUTER_MODEL",
    "INTERNAL_API_TOKEN",
  ];
  requireValues(backend, [...shared, "DATABASE_URL"], "backend.env");
  requireValues(voice, [...shared, "DEEPGRAM_API_KEY"], "voice-agent.env");
  for (const key of [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "INTERNAL_API_TOKEN",
  ]) {
    if (backend[key] !== voice[key])
      throw new Error(`${key} must match between the two env files`);
  }
  requireUrl(backend.DATABASE_URL, "DATABASE_URL", [
    "postgres:",
    "postgresql:",
  ]);
  for (const env of [backend, voice]) {
    requireUrl(env.LIVEKIT_URL, "LIVEKIT_URL", [
      "ws:",
      "wss:",
      "http:",
      "https:",
    ]);
    requireUrl(env.AI_ROUTER_BASE_URL, "AI_ROUTER_BASE_URL", [
      "http:",
      "https:",
    ]);
  }
  const tracing = [
    "LANGFUSE_BASE_URL",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
  ];
  if (tracing.some((key) => backend[key]?.trim())) {
    requireValues(backend, tracing, "Langfuse configuration");
    requireUrl(backend.LANGFUSE_BASE_URL, "LANGFUSE_BASE_URL", [
      "https:",
      "http:",
    ]);
  } else {
    for (const key of tracing) delete backend[key];
  }
  if (worker) {
    const workerShared = [
      "DATABASE_URL",
      "AI_ROUTER_BASE_URL",
      "AI_ROUTER_API_KEY",
      "AI_ROUTER_MODEL",
      "BULLMQ_REDIS_URL",
    ];
    requireValues(worker, workerShared, "evaluation-worker.env");
    // The worker and the backend must agree on the database, model router, and
    // the Redis instance carrying the evaluation queue.
    for (const key of [
      "DATABASE_URL",
      "AI_ROUTER_BASE_URL",
      "AI_ROUTER_API_KEY",
      "AI_ROUTER_MODEL",
      "BULLMQ_REDIS_URL",
    ]) {
      if (worker[key] !== backend[key])
        throw new Error(
          `${key} must match between the backend and evaluation worker env files`,
        );
    }
    requireUrl(worker.BULLMQ_REDIS_URL, "BULLMQ_REDIS_URL", [
      "redis:",
      "rediss:",
    ]);
    for (const key of tracing) {
      if (backend[key] !== undefined) worker[key] = backend[key];
      else delete worker[key];
    }
    worker.EVALUATION_WORKER_CONCURRENCY =
      worker.EVALUATION_WORKER_CONCURRENCY?.trim() || "1";
  }
  backend.PORT = "8080";
  backend.CORS_ALLOWED_ORIGINS = publicOrigin;
  voice.BACKEND_BASE_URL = "http://backend:8080";
  voice.VOICE_OUTBOX_DIR = "/app/data/voice-outbox";
  const serialize = (env) =>
    Object.entries(env)
      .map(([key, value]) => {
        if (/[\r\n\0]/.test(value))
          throw new Error(
            `${key} cannot contain line breaks or NUL in a Docker env file`,
          );
        return `${key}=${value}`;
      })
      .join("\n") + "\n";
  return {
    backend: serialize(backend),
    voice: serialize(voice),
    worker: worker ? serialize(worker) : "",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const env = prepareEnv(
      readFileSync("/run/backend.input", "utf8"),
      readFileSync("/run/voice.input", "utf8"),
      process.env.PUBLIC_ORIGIN,
      readFileSync("/run/worker.input", "utf8"),
    );
    writeFileSync("/run/output/backend.env", env.backend, { mode: 0o600 });
    writeFileSync("/run/output/voice-agent.env", env.voice, { mode: 0o600 });
    writeFileSync("/run/output/evaluation-worker.env", env.worker, {
      mode: 0o600,
    });
    console.log(
      "Runtime env files parsed and validated; secret values withheld.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
