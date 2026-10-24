import { expect, test } from "bun:test";
import { prepareEnv } from "./prepare-env.mjs";

const shared = `LIVEKIT_URL=wss://example.livekit.cloud
LIVEKIT_API_KEY=test-key
LIVEKIT_API_SECRET=test-secret
AI_ROUTER_BASE_URL=https://router.example.com/v1
AI_ROUTER_API_KEY=test-router-key
AI_ROUTER_MODEL=test-model
INTERNAL_API_TOKEN=shared-test-token`;
const backend = `${shared}
DATABASE_URL="postgresql://test:test@localhost/test?sslmode=require"
BETTER_AUTH_SECRET=test-auth-secret-that-is-at-least-32-characters
RESEND_API_KEY=test-resend-key
AUTH_EMAIL_FROM=RepoRound <auth@example.com>`;
const voice = `${shared}\nDEEPGRAM_API_KEY=test-deepgram-key`;
const origin = "https://example.com";

test("converts Windows dotenv files and quoted Langfuse values into Docker env syntax", () => {
  const result = prepareEnv(
    (
      backend +
      '\nLANGFUSE_BASE_URL="https://us.cloud.langfuse.com" # region\nLANGFUSE_PUBLIC_KEY="public"\nLANGFUSE_SECRET_KEY="secret"'
    ).replaceAll("\n", "\r\n"),
    voice,
    origin,
  );
  expect(result.backend).toContain(
    "DATABASE_URL=postgresql://test:test@localhost/test?sslmode=require\n",
  );
  expect(result.backend).toContain(
    "LANGFUSE_BASE_URL=https://us.cloud.langfuse.com\n",
  );
  expect(result.backend).toContain(`CORS_ALLOWED_ORIGINS=${origin}\n`);
  expect(result.backend).toContain(`BETTER_AUTH_URL=${origin}\n`);
  expect(result.backend).toContain(`AUTH_TRUSTED_ORIGINS=${origin}\n`);
  expect(result.backend).toContain("AUTH_COOKIE_SECURE=true\n");
  expect(result.voice).toContain("BACKEND_BASE_URL=http://backend:8080\n");
});

test("optional empty tracing configuration is omitted, but partial tracing fails", () => {
  expect(
    prepareEnv(backend + '\nLANGFUSE_BASE_URL=""', voice, origin).backend,
  ).not.toContain("LANGFUSE_BASE_URL");
  expect(() =>
    prepareEnv(backend + "\nLANGFUSE_SECRET_KEY=secret", voice, origin),
  ).toThrow("LANGFUSE_BASE_URL is required");
});

test("rejects mismatched credentials and invalid database URLs without disclosing values", () => {
  expect(() =>
    prepareEnv(
      backend,
      voice.replace("shared-test-token", "different-sensitive-token"),
      origin,
    ),
  ).toThrow("INTERNAL_API_TOKEN must match");
  expect(() =>
    prepareEnv(
      backend.replace(
        "postgresql://test:test@localhost/test?sslmode=require",
        "sensitive-but-invalid",
      ),
      voice,
      origin,
    ),
  ).toThrow("DATABASE_URL must be a valid URL");
});

test("evaluation worker env must mirror the backend queue, router, and database settings", () => {
  const queue = "BULLMQ_REDIS_URL=redis://cache.internal:6379";
  const backendWithQueue = `${backend}\n${queue}`;
  const worker = `${shared}\nDATABASE_URL=postgresql://test:test@localhost/test?sslmode=require\n${queue}`;
  const result = prepareEnv(backendWithQueue, voice, origin, worker);
  expect(result.worker).toContain("EVALUATION_WORKER_CONCURRENCY=1\n");
  expect(result.worker).toContain(`${queue}\n`);
  expect(result.backend).toContain(`${queue}\n`);
  expect(() =>
    prepareEnv(
      backendWithQueue,
      voice,
      origin,
      worker.replace("cache.", "other."),
    ),
  ).toThrow("BULLMQ_REDIS_URL must match");
});

test("rejects multiline secrets and origins that would change proxy routing", () => {
  expect(() =>
    prepareEnv(backend + '\nGITHUB_TOKEN="line1\\nline2"', voice, origin),
  ).toThrow("GITHUB_TOKEN cannot contain line breaks");
  expect(() => prepareEnv(backend, voice, "https://example.com/api")).toThrow(
    "PUBLIC_ORIGIN must be an HTTPS origin",
  );
});

test("production auth requires email delivery and a persistent strong secret", () => {
  expect(() =>
    prepareEnv(
      backend.replace("RESEND_API_KEY=test-resend-key", ""),
      voice,
      origin,
    ),
  ).toThrow("RESEND_API_KEY is required");
  expect(() =>
    prepareEnv(
      backend.replace(
        "BETTER_AUTH_SECRET=test-auth-secret-that-is-at-least-32-characters",
        "BETTER_AUTH_SECRET=short",
      ),
      voice,
      origin,
    ),
  ).toThrow("BETTER_AUTH_SECRET must be at least 32 characters");
});

test("proxy identity uses a generated private token shared only with backend and Caddy", () => {
  const result = prepareEnv(backend, voice, origin);
  const token = result.proxy.match(/TRUSTED_PROXY_TOKEN=([a-f0-9]{64})\n/)?.[1];
  expect(token).toHaveLength(64);
  expect(result.backend).toContain(`TRUSTED_PROXY_TOKEN=${token}\n`);
  expect(result.voice).not.toContain("TRUSTED_PROXY_TOKEN");
  expect(result.worker).not.toContain("TRUSTED_PROXY_TOKEN");
  expect(() =>
    prepareEnv(backend + "\nTRUSTED_PROXY_TOKEN=weak", voice, origin),
  ).toThrow("TRUSTED_PROXY_TOKEN must be");
});
