# AI Interviewer

A repository-aware technical interviewer with a cascaded voice pipeline and a durable interview orchestrator.

## Architecture

- `apps/backend`: Hono API, GitHub analysis, interview objectives and policies, PostgreSQL state, repository tools, durable jobs, the System Design graph store, and evidence-backed evaluation. It also hosts the BullMQ dispatch relay that publishes post-interview evaluation work.
- `apps/voice-agent`: LiveKit voice worker, Silero VAD, Deepgram STT/TTS, playback interruptions, final answers, and spoken transcript events.
- `apps/evaluation-worker`: standalone BullMQ consumer that runs evidence-backed evaluation off the request path, so a Redis outage or slow model call cannot block interview finalization.
- `apps/web`: Next.js candidate flow, live transcripts, reconnect, the System Design canvas, and interview results.
- `packages/providers`: provider configuration and construction.
- `packages/db`: Prisma schema, migration history, generated client, and shared database connection, exposed through `@repo/db`.

The backend owns interview progression. Models extract information and generate questions; application code controls phases, objectives, difficulty, deadlines, and state changes. The voice worker speaks backend questions and cancels playback locally when candidate speech interrupts it.

Two interview modes are supported. **GitHub** mode is repository-aware: the candidate discusses a repository and claims are checked against indexed source. **System Design** mode presents an immutable component-graph canvas: the candidate submits an architecture snapshot that is persisted in PostgreSQL and projected into a FalkorDB property graph, then the interviewer probes it along ordered graph paths and issues a scripted failure challenge before allowing one optional revision.

The implementation specification is in [spec/improvement-spec.md](spec/improvement-spec.md). Its October 1 delivery decisions supersede the original first-release scope.

## Response latency

During an interview, a final candidate turn follows:

```text
STT → persist answer → lightweight answer analysis → select action → generate question → TTS
```

Answer analysis and question generation each have a four-second request limit and one attempt. If analysis fails, the transcript stays durable and the interviewer asks a clarification. Question generation has a safe fallback. These limits bound model requests; they are not a guarantee of total end-to-end latency.

Detailed repository claim checks, failed analysis recovery, and scoring run after the interview:

```text
END job → recover pending analysis → VERIFY jobs → EVALUATE intent → Redis/BullMQ → evaluation-worker → result
```

The `EVALUATE` intent is a durable PostgreSQL row, not the work itself. A dispatch relay in the backend publishes it to the `evaluate` BullMQ queue with a stable job id (`eval-<interviewId>-v1`) and marks it dispatched; the PostgreSQL job poller excludes `EVALUATE` so a single owner consumes each intent. The `apps/evaluation-worker` process performs the model calls and writes the evaluation. Because the intent is durable, a Redis outage or a crashed worker leaves it recoverable: the relay re-queues stale dispatched intents during reconciliation, and the result page keeps polling. Exhausting the bounded retries marks the interview `evaluation_failed`, which the result page surfaces with a retry action.

Claim verification checks whether fetched code supports or contradicts a factual statement. Missing code in a partial index is not a contradiction. Repository implementation alone never demonstrates candidate competence.

## State and recovery

- Objective plans replace static question banks. Each question records its objective, phase, difficulty, reason, and code references when available.
- Final answers are persisted before reasoning. Stable turn IDs deduplicate retries. Runtime leases and version checks serialize state changes across backend processes.
- The clock starts when the voice session is allocated. It survives reconnects and worker restarts.
- Session allocation is serialized in PostgreSQL. The session row exists before LiveKit dispatch.
- Disconnects allow a configured reconnect window. Heartbeats detect stale workers. Reconnecting restores the pending question and persisted transcript.
- The browser End action immediately stops further progression. Finalization and evaluation use unique durable job keys, expiring leases, and bounded retries.
- Failed evaluations can be retried from the result page.
- PostgreSQL jobs allow four total executions, including the initial attempt; lock contention and intentional deferrals do not spend that budget. BullMQ evaluation retries have their own policy.
- Voice events are journaled until the backend acknowledges them. For durable recovery across container replacement, mount `VOICE_OUTBOX_DIR` on persistent storage. Its default OS temporary directory covers process restarts on the same host.

## Repository knowledge and limits

Only HTTPS GitHub repository URLs are accepted. Fetches are pinned to a commit SHA. The index contains up to 1,500 paths and 24 selected text files, at most 10,000 characters per file and 120,000 characters overall. Repositories over 100 MB are rejected. This is a partial index, not a full code audit.

Read tools expose project context, architecture, bounded file excerpts, lexical symbol lookup, code search, dependency lookup, candidate state, and the current objective. Code references include path, commit SHA, and line range. Symbol lookup uses lexical declarations rather than a language-specific AST. Dependency lookup currently supports `package.json`; other manifests contribute to repository analysis and can be inspected with file/search tools.

GitHub mode also derives an **evidence-only repository graph** from `RepositoryKnowledge`, pinned to the analyzed commit SHA. Edges are limited to facts provable from the index: `IMPORTS` between indexed files (a relative specifier resolved within the index, with its line), `IMPORTS_MODULE` for bare imports a file literally declares, and `DEPENDS` for manifest dependency keys with their version. A relative import whose target is not indexed produces no edge, and a truncated manifest produces no dependency edges. Objective questions may cite graph-grounded facts (for example, a module and its indexed importers); when the index cannot support a fact, no relationship is asserted.

Repository analysis and indexed source excerpts are stored together in `RepositoryKnowledge`. The consolidation migration copies legacy `GithubContext` analysis into that record before dropping the duplicate table. Existing source indexes and richer analysis are preserved. The unused `Interview.systemPrompt` and `InterviewPlan.questions` columns are removed; actual question history remains in interview runtime state.

Repository text and candidate answers are untrusted data. All structured model outputs are validated with Zod. Model-proposed tools cannot directly mutate interview state. Limits include 40 questions, five tool calls per registry operation, 200 tool calls per interview, 60,000 input characters per model request, and bounded output tokens.

## System Design graph (FalkorDB)

System Design mode uses FalkorDB as its topology layer. PostgreSQL remains the source of truth for the interview and the submitted snapshot; the graph is a rebuildable projection used to choose questions. Each accepted canvas snapshot is installed under an immutable `submissionId`, so revision 1 and revision 2 never share nodes or edges. The GitHub repository graph described above is a separate, in-memory evidence-only structure and is not stored in FalkorDB.

### Data model

| Element              | Properties                                                                | Meaning                                             |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| `(:DesignComponent)` | `interviewId`, `submissionId`, `revision`, `componentId`, `kind`, `label` | One node per component on the canvas                |
| `[:FLOWS_TO]`        | `submissionId`, `edgeId`                                                  | Directed request or data flow from source to target |

`kind` is one of `client`, `load_balancer`, `api_service`, `database`, `cache`, `message_queue`, `worker`, `object_storage`, `external_service`, or `cdn`. Every node and edge carries the `submissionId`, which is the isolation boundary for all reads and writes.

```text
(client)-[:FLOWS_TO]->(load_balancer)-[:FLOWS_TO]->(api_service)
(api_service)-[:FLOWS_TO]->(database)
(api_service)-[:FLOWS_TO]->(message_queue)-[:FLOWS_TO]->(worker)
(worker)-[:FLOWS_TO]->(external_service)
```

### Lifecycle

1. A submitted snapshot is stored in `SystemDesignSubmission` with `graphStatus = BUILDING`.
2. The backend installs the snapshot: any existing nodes for that `submissionId` are detached and deleted, then nodes and edges are created.
3. Verification counts nodes and edges and asserts there are no cross-submission edges. A mismatch marks the submission `FAILED` and returns `503`; replaying the same `requestId` rebuilds a failed submission.
4. Only `READY` submissions are read by the interviewer. Revision 1 is required to start; at most one optional revision 2 is allowed.

### Cypher queries the product depends on

```cypher
// Install components
UNWIND $nodes AS row
CREATE (n:DesignComponent {
  interviewId: $interviewId,
  submissionId: $submissionId,
  revision: $revision,
  componentId: row.componentId,
  kind: row.kind,
  label: row.label
})

// Install directed flows
UNWIND $edges AS row
MATCH (s:DesignComponent {submissionId: $submissionId, componentId: row.source})
MATCH (t:DesignComponent {submissionId: $submissionId, componentId: row.target})
CREATE (s)-[:FLOWS_TO {submissionId: $submissionId, edgeId: row.edgeId}]->(t)

// Verify node count, edge count, and scope isolation
MATCH (n:DesignComponent {submissionId: $submissionId}) RETURN count(n) AS value
MATCH (:DesignComponent {submissionId: $submissionId})-[r:FLOWS_TO {submissionId: $submissionId}]->(:DesignComponent {submissionId: $submissionId}) RETURN count(r) AS value
MATCH (a:DesignComponent)-[r:FLOWS_TO {submissionId: $submissionId}]->(b:DesignComponent)
WHERE a.submissionId <> $submissionId OR b.submissionId <> $submissionId
RETURN count(r) AS value

// Components and edges for probe selection
MATCH (c:DesignComponent {submissionId: $submissionId})
RETURN c.componentId AS componentId, c.kind AS kind, c.label AS label
ORDER BY c.componentId

MATCH (s:DesignComponent {submissionId: $submissionId})
  -[r:FLOWS_TO {submissionId: $submissionId}]->
  (t:DesignComponent {submissionId: $submissionId})
RETURN r.edgeId AS edgeId, s.componentId AS sourceId, s.kind AS sourceKind,
       t.componentId AS targetId, t.kind AS targetKind

// Multi-hop traversal: every component that can reach an external provider
MATCH p = (source:DesignComponent {submissionId: $submissionId})
  -[:FLOWS_TO*1..5]->
  (provider:DesignComponent {submissionId: $submissionId, componentId: $providerId})
RETURN DISTINCT source.componentId AS upstreamId, source.label AS upstreamLabel
LIMIT 30

// Queue to worker pairs
MATCH (q:DesignComponent {submissionId: $submissionId, kind: $queueKind})
  -[:FLOWS_TO]->(w:DesignComponent {submissionId: $submissionId, kind: $workerKind})
RETURN q.componentId AS queueId, w.componentId AS workerId

// Orphan components (no incoming or outgoing flow)
MATCH (c:DesignComponent {submissionId: $submissionId})
WHERE NOT (c)-[:FLOWS_TO]-() AND NOT (c)<-[:FLOWS_TO]-()
RETURN c.componentId AS componentId, c.kind AS kind
```

The hop bound in the traversal is clamped to `1..5` and interpolated into the query, because the Cypher grammar does not accept a parameter for the upper bound of a variable-length path.

### Algorithms

- **Ordered path search** (`findOrderedPath`): bounded, cycle-safe DFS over the graph facts. It finds a directed path whose visited nodes match a requested kind sequence while allowing unrelated intermediate nodes. The interviewer uses `api_service → message_queue → worker`, `api_service → database`, and `worker → external_service`.
- **Deterministic probe selection** (`selectProbe`): application policy, not an LLM tool loop. It prefers a topology-specific probe, skips probe IDs already asked, and falls back to an arrow-direction or general scaling question when the graph is minimal. After three probes the interview issues the scripted failure challenge.
- **Explainability**: every probe records `probeId`, `submissionId`, `revision`, `referencedComponentIds`, `graphPath`, and a human-readable `reason`; the selected probe is also written to `system_design.probe` interview events. Question wording is generated from those facts, so a follow-up can be traced back to the exact path in the submitted graph.

Configuration: `FALKORDB_HOST` (default `localhost`), `FALKORDB_PORT` (default `6379`), and `FALKORDB_GRAPH` (default `ai_interviewer`). Read queries use a 400 ms timeout and writes a 5 s timeout; a failed connection is reset and re-established on the next call.

## Evaluation

The evaluation includes technical depth, architecture, debugging, implementation, tradeoff reasoning, and communication. Final grading reads the recorded candidate answers directly, including adjacent speech fragments, instead of trusting speculative live summaries. Every assessed category includes a numeric score, confidence, and quotes checked against the originating candidate turns. Confidence expresses certainty of the assessment, not candidate ability: a clearly weak answer can receive a low score with high confidence. Unsupported categories and scores remain `INSUFFICIENT_EVIDENCE` / `null`; pipeline failures and unexplored objectives are not candidate weaknesses. Overall and dimension scores are calculated from assessed categories, excluding unassessed areas.

The responsive result view includes a skill breakdown, supporting answer quotes, session details, transcript review, and an option to regenerate an assessment of the saved answers.

Evaluation reads every transcript page. Candidate answers share the model input budget, retaining both the beginning and end of long answers. The completion event records included, omitted and shortened candidate-turn counts. Partial coverage is shown in the result view and feedback, with confidence capped at 0.65; omitted content is not evidence of a weakness. Older assessments without coverage metadata remain readable.

## Access and security

RepoRound requires an email/password account with a verified email. Better Auth runs at `/api/auth/*`, stores sessions in PostgreSQL, and issues HttpOnly `SameSite=Lax` cookies scoped to the app origin. Passwords are hashed with Argon2id. Session tokens are stored as an HMAC-SHA256 digest, so a database read cannot be replayed as a browser session. Cookies are `Secure` when `BETTER_AUTH_URL` uses HTTPS.

Interviews belong to the authenticated account; every public interview operation checks ownership on the server. The API never accepts a user ID from the browser. Sign-up, sign-in, resend-verification, and password-reset requests are rate limited per client IP. Password changes and resets revoke existing sessions. Google and GitHub sign-in are enabled only when both provider credentials are configured; implicit email-based account linking is disabled.

Accounts can be deleted from `/account`. Deletion removes the user's DesignComponent graph data first, then cascades through interviews, transcripts, evaluations, sessions, and linked provider accounts. If graph cleanup fails, account deletion stops rather than leaving orphaned data. The authentication migration intentionally deletes pre-auth anonymous browser sessions and interviews instead of guessing an owner.

The voice worker uses a separate internal bearer token and must supply a session belonging to the interview. The browser never receives server credentials or the internal token. Database-backed rate limits also cover interview creation, public operations, internal events, and candidate turns.

EC2 deployment generates a separate proxy credential for Caddy and the backend. Caddy overwrites the client-IP and proxy-credential headers; the backend accepts that client identity only when the credential matches. Other forwarding headers are ignored. This configuration assumes browsers connect directly to Caddy; adding a CDN requires configuring its trusted client identity at the proxy boundary. Unexpected API failures return a generic error and a server-generated request ID.

## Setup

Requirements: Bun 1.4.2, Node.js 24+, a PostgreSQL instance (local or managed), a Redis instance for BullMQ, LiveKit, Deepgram, and an OpenAI-compatible model endpoint. System Design mode additionally needs a reachable FalkorDB instance.

```bash
bun install
```

Copy each app's `.env.example` to `.env` and fill in credentials. Copy `packages/db/.env.example` to `packages/db/.env` and set its `DATABASE_URL` to your database's direct PostgreSQL connection URL. Set the backend's `DATABASE_URL` to the same database; the application may use a pooled connection URL. The backend and voice worker must share `INTERNAL_API_TOKEN`. From the repository root, generate the Prisma client and run migrations yourself against that database:

```bash
bun run db:generate
bun run db:migrate:deploy
bun run db:migrate:status
```

Authentication requires `BETTER_AUTH_URL` set to the public frontend origin (for example `http://localhost:3000`) and `BETTER_AUTH_SECRET` with at least 32 random characters. Locally, unset Resend credentials print verification and reset links to the backend console. Production requires `RESEND_API_KEY` and `AUTH_EMAIL_FROM`; set `AUTH_COOKIE_SECURE=false` only for local HTTP development. Optional `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` enable those providers; configure their callback URLs as `BETTER_AUTH_URL/api/auth/callback/google` and `.../github`. If you add more public origins, include them in `AUTH_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS`.

The web app calls the API through same-origin relative URLs. Next.js forwards `/api/*` to `BACKEND_URL` during local development (default `http://localhost:8080`); production Caddy routes `/api/*` directly to the backend.

Database commands are root aliases for scripts in `packages/db`; Prisma dependencies and files live in that package. Prisma loads `packages/db/.env` for these commands. Alternatively, export `DATABASE_URL` in your shell. Development migrations use `db:migrate`; deployments use `db:migrate:deploy`.

When applying the authentication migration to an existing deployment, stop the backend and voice workers first, take a database backup, apply the migration manually, and start images built from the updated code. The migration deletes anonymous browser sessions and their interviews; it does not assign them to an account. The previous backend requires the removed tables and cannot run against the new schema.

The backend targets 10–15 minutes for GitHub repository interviews and 30 minutes for system-design interviews, with a 300-second reconnect window. Optional `GITHUB_TOKEN` authenticates public GitHub API requests. Silero controls answer boundaries with a 1-second silence window, while Deepgram final segments accumulate within an answer (500 ms provider endpointing). Silero also detects interruptions; its defaults require 400 ms of speech and two transcribed words for interruption, reducing accidental cancellation from brief noises.

Start the backend and web app from the repository root:

```bash
bun run dev
```

Start the voice worker separately:

```bash
bun run agent:start
```

The worker dispatch name is `ai-interviewer`. Silero is preloaded once per worker process and reused for its session.

Start the evaluation worker separately as well:

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

Interview events and timings are recorded in PostgreSQL, including retrieval, planning, candidate turns, analysis, action selection, tools, question generation, voice timings, interruptions, claim checks, and evaluation.

To export traces, configure `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` in the backend. The exporter uses [Langfuse's OTLP endpoint](https://langfuse.com/docs/observability/get-started) and retries unacknowledged events from the database. Candidate answers and source excerpts are omitted from exported trace metadata. Without credentials, events remain local.

## Checks

GitHub Actions runs code checks and builds all four Docker images (backend, web, voice-agent, evaluation-worker) on pull requests, pushes to `main`, and manual runs. After code checks pass on a `main` push, it publishes images to Docker Hub under `manav2854` with `sha-<full commit SHA>` tags. Publishing requires the `DOCKERHUB_TOKEN` repository secret. Follow [docs/ci-practice.md](docs/ci-practice.md) to configure credentials, trigger runs, diagnose a deliberate failure, and require CI before merging. CI does not apply database migrations.

The separate **Deploy EC2** workflow deploys a successful CI image set over SSH. It defaults to a manual release button; automatic deployment after successful main CI is opt-in. It validates runtime env files and database access, recreates containers behind Caddy HTTPS, and checks the Better Auth session endpoint. Follow [docs/ec2-deployment.md](docs/ec2-deployment.md) for the required SSH secret, verified host keys, server env files, and runner network access. Database migrations remain manual.

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
