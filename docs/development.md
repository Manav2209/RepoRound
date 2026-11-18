# Development and operations

[Quick start](../README.md#local-setup) · [Runtime architecture](architecture.md) · [Recorded measurements](measurements.md)

Run the commands below from the repository root unless a section says otherwise. Environment examples are the source of truth for required settings.

## Setup

Requirements: Bun 1.4.2, Node.js 24+, a PostgreSQL instance (local or managed), a Redis instance for BullMQ, LiveKit, Deepgram, and an OpenAI-compatible model endpoint. System Design mode additionally needs a reachable FalkorDB instance.

```bash
bun install
```

Copy each app's `.env.example` to `.env` and fill in credentials. Omit unused optional settings instead of leaving blank values; for local console-only email, comment out or remove `RESEND_API_KEY` and `AUTH_EMAIL_REPLY_TO`. Copy `packages/db/.env.example` to `packages/db/.env` and set its `DATABASE_URL` to your database's direct PostgreSQL connection URL. Set the backend's `DATABASE_URL` to the same database; the application may use a pooled connection URL. The backend and voice worker must share `INTERNAL_API_TOKEN`. From the repository root, generate the Prisma client and run migrations yourself against that database:

```bash
bun run db:generate
bun run db:migrate:deploy
bun run db:migrate:status
```

Authentication requires `BETTER_AUTH_URL` set to the public frontend origin (for example `http://localhost:3000`) and `BETTER_AUTH_SECRET` with at least 32 random characters. Locally, unset Resend credentials print verification and reset links to the backend console. Production requires `RESEND_API_KEY` and `AUTH_EMAIL_FROM`; set `AUTH_COOKIE_SECURE=false` only for local HTTP development. Optional `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` enable those providers; configure their callback URLs as `BETTER_AUTH_URL/api/auth/callback/google` and `.../github`. If you add more public origins, include them in `AUTH_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS`.

The web app calls the API through same-origin relative URLs. Next.js forwards `/api/*` to `BACKEND_URL` during local development (default `http://localhost:8080`); production Caddy routes `/api/*` directly to the backend.

Database commands are root aliases for scripts in `packages/db`; Prisma dependencies and files live in that package. Prisma loads `packages/db/.env` for these commands. Alternatively, export `DATABASE_URL` in your shell. Development migrations use `db:migrate`; deployments use `db:migrate:deploy`.

When applying the authentication migration to an existing deployment, stop the backend and voice workers first, take a database backup, apply the migration manually, and start images built from the updated code. The migration deletes anonymous browser sessions and their interviews; it does not assign them to an account. The previous backend requires the removed tables and cannot run against the new schema.

The backend defaults to 15 minutes for GitHub repository interviews and 30 minutes for system design, including initial drawing. System Design and legacy database-backed GitHub sessions use a 300-second reconnect window. The system design duration change applies to new rounds; session allocation does not reset an existing runtime's saved deadline. Optional `GITHUB_TOKEN` authenticates public GitHub API requests. Silero VAD controls answer boundaries and detects interruptions.

Repository interviews default to `GITHUB_ACTIVE_STORAGE=memory` and `GITHUB_TURN_MODE=combined`. Repository context loads once, active conversation/state/telemetry stay in a bounded process-local store, and a normal answer uses one model request for assessment and a proposed question. Application policy still chooses the allowed next objective and uses a grounded fallback when the proposal does not pass checks. The opening uses a prepared source-backed fallback rather than another startup model request. Completion persists transcript, final state, metrics events and the durable END intent before background evaluation. Closing-speech events drain before raw cleanup. `GITHUB_ACTIVE_STORAGE=postgres` and `GITHUB_TURN_MODE=separate` retain the earlier implementation for comparison. System Design keeps its existing durable architecture/checkpoint flow and deterministic bank.

Memory mode requires one backend owner for an active interview. It is bounded to 32 sessions and a serialized-content budget of 128 MiB overall / 16 MiB per session; these are accounting limits, not exact JavaScript heap measurements. Account/report cleanup evicts its active data. Disconnected sessions are finalized after a 30-second grace; abandoned rounds are distinguished in retained metrics. Do not deploy this mode across independent backend replicas without session ownership or a shared store. Transcript retention after completed-report cleanup remains unchanged.

Start the backend, web app, voice worker, and evaluation worker from the repository root:

```bash
bun run dev
```

When running services individually instead, start the voice worker with:

```bash
bun run agent:start
```

The worker dispatch name is `ai-interviewer`. Silero is preloaded once per worker process and reused for its session.

Start the evaluation worker with:

```bash
bun run evaluation-worker:start
```

The backend and evaluation worker must share the same `BULLMQ_REDIS_URL` (default `redis://localhost:6380`) and `DATABASE_URL`. `EVALUATION_WORKER_CONCURRENCY` bounds concurrent evaluations per worker. The backend also needs `BULLMQ_REDIS_URL` to publish evaluation intents. For System Design mode, set `FALKORDB_HOST`, `FALKORDB_PORT`, and `FALKORDB_GRAPH` in the backend.

## Docker

Run Docker commands from the repository root (`my-turborepo`), since all apps depend on workspace packages. Each app has its own multi-stage Dockerfile. Containers run as an unprivileged user, and `.dockerignore` excludes local dependencies, build outputs, and environment files.

Fill in `apps/backend/.env`, `apps/voice-agent/.env`, and `apps/evaluation-worker/.env` using their examples. Set `DATABASE_URL` in `apps/backend/.env` and `apps/evaluation-worker/.env` to your managed PostgreSQL connection URL, with the TLS settings required by your provider, and set `BULLMQ_REDIS_URL` in the backend and evaluation worker to the same Redis instance. Use the same LiveKit project, model endpoint, and `INTERNAL_API_TOKEN` in the backend and voice worker. PostgreSQL, Redis, FalkorDB, LiveKit, Deepgram, and the model endpoint remain external services.

Run migrations yourself from a machine that can reach the managed database, before starting the application. After installing workspace dependencies, run this command from the repository root to apply migrations from `packages/db/prisma/migrations` using `packages/db/.env`:

```bash
bun run db:migrate:deploy
```

The backend image generates the Prisma client during its build. Client generation creates application code from the schema; it does not apply migrations or copy database data. Migration files remain in the repository for your manual migration workflow. The application containers do not run migrations on startup.

The web image contains no public backend URL. Serve the web app and backend behind one origin so browser requests to `/api/*` reach the backend and authentication cookies remain same-origin. The EC2 deployment's Caddy configuration does this. Add that public frontend origin to `CORS_ALLOWED_ORIGINS`, and set `BETTER_AUTH_URL` to it.

If a provider runs on the Docker host, use `host.docker.internal` instead of `localhost` in its configured URL on Docker Desktop. A self-hosted LiveKit URL must also be reachable by the browser, since it is returned with the session token.

Build individual images from the same root:

```bash
docker build -f apps/backend/Dockerfile -t ai-interview-backend:local .
docker build -f apps/voice-agent/Dockerfile -t ai-interview-voice-agent:local .
docker build -f apps/evaluation-worker/Dockerfile -t ai-interview-evaluation-worker:local .
docker build -f apps/web/Dockerfile -t ai-interview-web:local .
```

Run the images individually with Docker or your deployment platform. Supply the backend, voice worker, and evaluation worker environment variables at runtime. The voice worker's `BACKEND_BASE_URL` must resolve to the backend from inside its container. The evaluation worker needs the same `DATABASE_URL`, `BULLMQ_REDIS_URL`, and model-router credentials as the backend; it has no listening port. `apps/backend` and `apps/evaluation-worker` connect to Redis, so it must be reachable from both containers. Publish port 8080 for the backend and port 3000 for the web app when running locally, and wait for the backend's `/health` endpoint before starting the voice worker.

The voice image runs the worker in LiveKit's production `start` mode. Its health endpoint is on internal port 8081; it needs no published audio port because it connects to LiveKit. Mount persistent storage at `/app/data/voice-outbox` to preserve unacknowledged voice events across container replacement. Allow up to 65 minutes for active interviews to drain when stopping the voice container, for example with Docker's `--stop-timeout 3900` option when creating it.

Your managed database has its own lifecycle and backups, independent of the application containers.

## Observability

### Retained operational metrics

Authenticated accounts can request `GET /api/v1/metrics`. The response is owner-scoped, uses `Cache-Control: no-store`, and includes up to the 200 most recent recorded rounds with the total available count and selection limit. Rounds without an allocated voice session are distinguishable from started rounds; unfinished started rounds remain in the completion-rate denominator. This is a recent selected history, not a lifetime or production-wide success rate.

The endpoint reports:

- Sample counts, mean, p50, p95, and maximum duration by measured stage, including model requests, backend attempts, and voice response/startup events. Failed and cancelled samples are counted separately from successful latency samples.
- Model request/failure counts, reported input/output/cached tokens, streaming-STT audio usage, TTS characters, and provider request counts where available. Streaming STT usage duration is not treated as transcript latency.
- Repeat requests handled, disconnects, voice errors, observed retry attempts, and the number of eligible repository questions with valid pinned source references.
- Coverage metadata, including rounds without summaries, event truncation, and busy rounds whose snapshot could not be refreshed during the read.

`voice.response_start` is a worker engine-speaking proxy; it does not measure when audio became audible in the browser. Startup records keep the actual intentional wait separately. Only adjusted startup duration subtracts that recorded wait (normally 10 seconds); ordinary turn, backend, and model-call durations never subtract ten seconds.

Numeric summaries survive raw-interview cleanup but are removed when their report or owning account is deleted. Deletion therefore changes the history available to aggregate. Reference coverage is not human-rated question relevance or factual correctness, and disconnect/retry counts do not establish a recovery-success rate. See [recorded measurements](measurements.md) for the controlled development runs. These instruments alone do not establish production reliability or semantic evaluation accuracy; those claims require controlled measurements and an appropriate denominator.

Optional `METRICS_LLM_INPUT_USD_PER_MILLION`, `METRICS_LLM_OUTPUT_USD_PER_MILLION`, `METRICS_STT_USD_PER_MINUTE`, and `METRICS_TTS_USD_PER_MILLION_CHARACTERS` rates enable an estimated cost from reported usage. With unknown rates or usage, the estimate is absent or incomplete rather than a claim of zero cost. It is not a provider invoice: cached-token rates, failed requests, multiple models, and provider-specific billing can differ from the configured approximation.

Voice cleanup waits for the worker's SDK-close and journal-drain acknowledgment, with a bounded 30-second grace after report completion. If the worker never acknowledges, cleanup proceeds and metrics mark voice usage as incomplete. This prevents an unavailable worker from retaining raw interviews indefinitely. Repeat-request timings have their own `repeat_request` stage and are excluded from `candidate_turn` answer timings.

For a reproducible controlled backend benchmark, run `bun run scripts/benchmark-system-design.ts --live` from `apps/backend` with `DATABASE_URL` pointing to a migrated disposable local database named `rr_metrics`. The script refuses managed databases, uses the configured live model with scripted answers and a shared fixture diagram, checks three-question/repeat/checkpoint/retention behavior for all ten problems, exports numeric results to `spec/benchmarks/system-design-controlled.json`, and deletes its test account. `--problems=chat-application,url-shortener` limits the selection. This excludes voice, browser networking, LiveKit dispatch, BullMQ delivery, drawing, and the intentional startup wait. The exported measurements describe this controlled development run; they do not establish production reliability or evaluation accuracy.

### Event traces

Interview events and timings cover retrieval, planning, candidate turns, analysis, action selection, tools, question generation, voice timings, interruptions, claim checks and evaluation. Active memory-backed repository sessions buffer their events until completion flush; durable events are recorded in PostgreSQL for export.

To export traces, configure `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` in the backend. The exporter uses [Langfuse's OTLP endpoint](https://langfuse.com/docs/observability/get-started) and retries unacknowledged events from the database. Candidate answers and source excerpts are omitted from exported trace metadata. Without credentials, events remain local.

## Checks

GitHub Actions runs code checks and builds all four Docker images (backend, web, voice-agent, evaluation-worker) on pull requests, pushes to `main`, and manual runs. After code checks pass on a `main` push, it publishes images to Docker Hub under `manav2854` with `sha-<full commit SHA>` tags. Publishing requires the `DOCKERHUB_TOKEN` repository secret. Follow [docs/ci-practice.md](ci-practice.md) to configure credentials, trigger runs, diagnose a deliberate failure, and require CI before merging. CI does not apply database migrations.

The separate **Deploy EC2** workflow deploys a successful CI image set over SSH. It defaults to a manual release button; automatic deployment after successful main CI is opt-in. It validates runtime env files and database access, recreates containers behind Caddy HTTPS, and checks the Better Auth session endpoint. Follow [docs/ec2-deployment.md](ec2-deployment.md) for the required SSH secret, verified host keys, server env files, and runner network access. Database migrations remain manual.

```bash
bun run check-types
bun run lint
bun run build
bun run --cwd apps/web test
cd apps/backend
bun run test
```

Unit checks cover objective selection, phase transitions, repository references and path validation, evaluation evidence validation, trace metadata, the System Design snapshot normalization and graph probing logic, the problem catalog, and the evidence-only GitHub repository graph (import resolution, manifest dependencies, and the no-fact-without-evidence rule).

Integration checks require live services and are gated behind `RUN_DB_TESTS=1` (they are skipped otherwise, so the default `bun run test` never touches a real database). The FalkorDB graph tests need a reachable FalkorDB and skip themselves when it is unavailable. Set `RUN_DB_TESTS=1` with a test `DATABASE_URL` and, for the real BullMQ transport test, a reachable `BULLMQ_REDIS_URL`:

```bash
cd apps/backend
$env:RUN_DB_TESTS="1"
bun test src
```

These cover the System Design submission idempotency and revision gating, the graph walk and probe selection, and the evaluation relay (dispatch, Redis-outage durability, reconciliation, retry exhaustion, and the single-owner BullMQ round trip). A production build and a successful local Silero load do not establish live microphone, provider, or Langfuse delivery behavior; verify those with the configured services before deployment.

With the backend, web app, voice agent, and evaluation worker running against a disposable local database, run `bun run scripts/smoke-interview.ts` from the repository root. It creates a verified test account through Better Auth, keeps the session cookie, submits a minimal System Design diagram, checks an idempotent replay, allocates a real LiveKit session, sends generated test answers through the internal API, verifies the revision challenge, waits for the queued evaluation, and deletes the test account. It uses configured LiveKit and model credentials; it does not test microphone audio.
