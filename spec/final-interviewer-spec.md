# AI Interviewer — Final Implementation Specification

**Status:** Final agreed implementation plan (not implemented)  
**Updated:** 18 October 2026  
**Repository:** https://github.com/Manav2209/ai-interviewer  
**Suggested repository path:** `spec/final-interviewer-spec.md`  
**Baseline:** `main` at Git tree `24894f69ac3b0562cc93995b25a5d73f1f0b3630`  
**Relationship to other docs:** This spec **supersedes the two proposed FalkorDB/canvas specs** for this feature and **extends, rather than replaces,** `spec/improvement-spec.md`. Preserve the existing README's reliability, security, answer-grounding, and LiveKit contracts. Where this spec conflicts with earlier proposals, **this document wins**.

---

## 0. Executive decision record (read first)

We are building **two** interview modes in the existing AI Interviewer, not a general-purpose AI assessment suite.

| Concern | Final decision |
|---|---|
| Modes | `GITHUB` (existing, extended) and `SYSTEM_DESIGN` (new) |
| System design questions | **10 predefined problem configurations**; fully polish Notification System first |
| Canvas | **React Flow** (`@xyflow/react`) in the existing Next.js frontend |
| Canvas lifecycle | **Draw first → explicitly submit → graph is built → voice interview starts** |
| During drawing | Pure client-side editor; **no** live FalkorDB writes or AI observations |
| After voice challenge | Exactly **one optional** edit-and-resubmit checkpoint (revision 2) |
| Canvas storage | Submitted immutable JSON snapshots in **PostgreSQL**; no autosave in P0 |
| Graph storage | **FalkorDB**: derived per-submission architecture / repository relationship graphs |
| Graph reasoning | Backend queries graph, **code deterministically selects a probe**, LLM phrases question |
| Orchestration | Keep the existing `apps/backend` process as the runtime owner; modularize strategies, **no separate orchestrator service** |
| Real-time voice | Existing `apps/voice-agent` LiveKit worker + current internal authenticated API |
| Jobs | **Redis + BullMQ for asynchronous final evaluation**, backed by durable PostgreSQL intent / outbox |
| Existing other jobs | Keep PostgreSQL job runner initially for `PREPARE`, `END`, `ANALYZE`, `VERIFY` |
| Evaluation worker | Add **one** independent worker process, no generic worker fleet |
| Source of truth | PostgreSQL for interview state, transcript, snapshots, evaluation, and job intent |
| Redis roles | BullMQ execution only; **separate Redis instance/config** from FalkorDB |
| Hackathon flagship | **Design a Notification System**: draw → submit → graph-driven voice probing → SMS provider outage challenge → resubmit → report |

**No additions to UX scope:** no graph highlighting, idle speech triggers, collaboration, co-drawing, live canvas sync, arbitrary node generation, code execution, infrastructure emulator, skill graph dashboard, or persistent agent memory. Do not make these prerequisites for completion.

### Definition of done

1. Existing GitHub interview still starts, speaks, reconnects, ends, and returns results.
2. Candidate can choose System Design, select Notification System, build a directed architecture using the constrained editor, and submit once.
3. The backend persists an immutable architecture snapshot, builds/verifies its FalkorDB representation, then allows a LiveKit interview to start.
4. A **Cypher traversal over the actual submission** determines at least one relevant follow-up; altering the architecture changes a testable probe decision.
5. After one prepared reliability challenge, candidate may modify and resubmit once. The agent discusses the **new** revision, not stale nodes.
6. Ending the interview immediately shows **evaluation pending**; a Redis/BullMQ worker produces the grounded report separately.
7. Database, graph, Redis, worker, reconnect, and retry failures do not silently lose an interview or invent evidence.

---

## 1. Verified current repository baseline

This is an extension of the current **Bun + Turborepo** monorepo; do not rewrite the stack.

| Existing location | Current responsibility | Planned change |
|---|---|---|
| `apps/web` | Next.js 16, interview UI, transcript/results | Mode selection, challenge list, React Flow canvas |
| `apps/backend` | Hono API, GitHub analysis, orchestration, DB jobs | Branch by interview mode, system-design graph/probe modules, eval outbox relay |
| `apps/voice-agent` | LiveKit voice worker, Deepgram, VAD, interrupt/reconnect | Keep transport; add mode-aware context only where needed |
| `packages/db` | Prisma + PostgreSQL | Mode columns, immutable design submissions, eval dispatch metadata |
| `packages/types` | Shared voice/session contracts | Canvas, problem, probe, and mode types |
| `packages/providers`, `packages/ui` | Shared providers/UI | Reuse as-is unless a typed contract requires adjustment |
| `apps/backend/src/interview/orchestrator.ts` | Start/turn policy, locks, questions, state transitions | Call mode strategies; stop requiring GitHub knowledge for design mode |
| `apps/backend/src/jobs/queue.ts` | PostgreSQL `InterviewJob` polling + leases | Retain non-eval jobs; exclude EVALUATE from local consumption |
| `apps/backend/src/evaluation/evaluation.service.ts` | Finalization, recover/verify preflight, evaluation persistence | Split evaluation execution into independent worker, preserve API behavior |
| `apps/backend/src/api/interviews.ts` | Creation requires `githubUrl` | Backward-compatible mode-specific validation |
| `apps/backend/src/api/internal.ts` | Secured voice-worker start/turn endpoints | Keep endpoint; dispatch strategy internally |

**Existing invariants to preserve:**

- Persist candidate final turns **before** any model reasoning; stable turn IDs deduplicate retries.
- PostgreSQL runtime leases and optimistic versions serialize interview mutations.
- Browser token ownership, separate voice internal token, and rate limits remain enforced.
- Questions have bounded model calls and fallbacks; existing voice interruptions and reconnect logic keep working.
- `RepositoryKnowledge` is the current source for GitHub indexed evidence; **do not** resurrect `GithubContext`.
- Evaluation grades **actual candidate answers**, not assumed competence from repository code or the mere presence of diagram nodes. Unknown coverage means `INSUFFICIENT_EVIDENCE`, not zero.
- Post-interview GitHub claim verification continues; unsupported source claims are not silently treated as proven.

---

## 2. User-facing flow — exactly two modes

### 2.1 Landing / mode selection

Provide two choices:

- **GitHub Technical Interview** — existing repository URL input and preparation flow.
- **System Design Interview** — fixed problem selection (10 entries) followed by canvas.

The GitHub flow remains usable with its current request body `{ "githubUrl": "https://github.com/..." }`.

### 2.2 GitHub interview (existing flow, graph extension)

```text
Select GitHub mode → paste public GitHub URL
  → existing scrape / RepositoryKnowledge / objective plan
  → derive grounded repository relationship graph in FalkorDB
  → existing LiveKit voice session
  → graph-guided architecture questions & adaptive follow-ups
  → transcript finalized → async evaluation → result
```

No repository graph requirement should break existing sessions during rollout; support a feature-flagged fallback to existing question planning until GitHub graph integration passes its tests. No persistent cross-session memory.

### 2.3 System Design (new flagship)

```text
Choose System Design → select one of 10 prepared problems
  → create interview (no GitHub URL)
  → open React Flow editor with prompt visible
  → add/move/rename/connect/delete components locally
  → click Submit Architecture
  → validate → immutable PostgreSQL submission revision 1
  → construct & verify FalkorDB graph for revision 1
  → READY response; only now start LiveKit interview
  → describe design; interviewer follows graph-grounded probes
  → one predefined challenge: SMS provider outage
  → candidate optionally revises and resubmits revision 2
  → compare graph/snapshots; conduct final follow-up
  → end → evaluation pending → async evaluation → report
```

**No background observation while drawing.** The agent never sees draft React state. A draft changing from A to B before submission produces **zero** graph work.

### 2.4 During a revision

Keep the existing LiveKit connection mounted. Display the same design editor within the active interview page for revision 2; **do not** navigate to an entirely different page that unmounts the voice session. While revision is requested, the agent should wait for explicit resubmission or a candidate verbal refusal; it must not assume a draft edit was submitted. The existing deadline continues to run. The candidate is not penalized simply for declining the optional revision.

---

## 3. System Design question bank

Use **one editor** and **one interview strategy** with a fixed, version-controlled bank; no per-problem frontends.

| `problemId` | Title | Main concepts |
|---|---|---|
| `notification-system` | Design a Notification System | queues, workers, retries, delivery guarantees |
| `url-shortener` | Design a URL Shortener | key generation, database, caching |
| `rate-limiter` | Design a Rate Limiter | atomicity, Redis, distributed coordination |
| `chat-application` | Design a Chat Application | sockets, ordering, fan-out, presence |
| `file-storage` | Design a File Storage Service | upload, metadata, object storage |
| `job-queue` | Design a Job Queue System | scheduling, retries, DLQ, leases |
| `news-feed` | Design a News Feed | fan-out, storage, pagination, freshness |
| `ride-hailing` | Design a Ride-Hailing System | location, matching, availability |
| `video-streaming` | Design a Video Streaming Platform | upload, encoding, CDN, storage |
| `ticket-booking` | Design a Ticket Booking System | contention, reservations, consistency |

### Version-controlled problem contract

```ts
type ProblemConfig = {
  id: string;
  version: 1;
  title: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  brief: string;
  visibleRequirements: string[];
  clarificationAnswers: Record<string, string>;
  evaluationGoals: string[]; // INTERNAL: not served in public catalog
  challenge: {
    id: string;
    prompt: string;
    targetConcepts: string[];
  };
};
```

**Notification System — canonical P0**

- Brief: *Design a service that accepts notification requests and delivers email, SMS, and push notifications. Describe major components and message flow.*
- Baseline reference: about **1 million notification requests/day**; let candidates state their peak/latency assumptions.
- Acceptance requirements: fast API acceptance, asynchronous dispatch, channel routing, resilience to temporary provider failures, reasonable handling of duplicates.
- Clarification facts: providers may fail temporarily; delivery is best-effort; true exactly-once third-party delivery is not guaranteed; user preferences can be assumed.
- Unlisted clarification: **"Make a reasonable assumption, state it, and continue."** Never invent hidden requirements.
- Single challenge: **"The SMS provider is down for 30 minutes. Explain what happens to pending notifications, then update your design to recover without duplicate bursts."**
- Candidate may demonstrate a valid alternative architecture; there is **no single rigid answer graph**.

For the other nine: provide a concise reviewed brief, visible requirements, clarification defaults, one challenge, and rubric goals. If time is short, make Notification System production-quality and let others reuse the common path without bespoke logic.

---

## 4. React Flow canvas — exact UX and behavior

### 4.1 Layout

```text
+--------------------------------------------------------------------------------+
| Design a Notification System                                        [Design]   |
| Short question brief and visible requirements                                 |
+-----------------------+--------------------------------------------------------+
| COMPONENTS            |                                                        |
| Client                |                 React Flow Canvas                      |
| Load Balancer         |     [API] ---> [Queue] ---> [Worker] ---> [SMS]         |
| API / Service         |                                                        |
| Database              |      (pan, zoom, drag, connect)                         |
| Cache                 |                                                        |
| Message Queue         |                                                        |
| Worker                |                                                        |
| Object Storage        |                                                        |
| External Service      |                                                        |
| CDN                   |                                                        |
+-----------------------+--------------------------------------------------------+
|                        [Submit Architecture]                                   |
+--------------------------------------------------------------------------------+
```

During voice interview, reuse the same submitted diagram read-only until the single revision checkpoint. No visual agent annotations or extra toolbar.

### 4.2 Allowed actions

1. Add a component using sidebar drag/drop or click-to-place.
2. Move a node to arrange the architecture.
3. Create a directed arrow between two components.
4. Edit a component's label (e.g. `SMS Provider`), or delete a node/edge.
5. Submit the completed architecture explicitly.

### 4.3 Exactly 10 component kinds

`client`, `load_balancer`, `api_service`, `database`, `cache`, `message_queue`, `worker`, `object_storage`, `external_service`, `cdn`.

Use one custom React Flow node type (e.g., `architecture`) with `data.componentType` and `data.label`. Each node has directional connection handles. Use arrows in the direction the **candidate intends data to flow**. No forced semantic edge selector, no protocols, no autosuggest.

### 4.4 Editor constraints and validation

- Up to **75 nodes / 150 edges**, max label length 80 chars, unique stable node and edge IDs.
- Reject edges with missing endpoints, duplicate source-target pairs, or self-loops for MVP. Directed cycles between distinct nodes are allowed: many real architectures are cyclic.
- Require at least 2 nodes and 1 edge for initial submission; do not demand a particular solution topology.
- Validate finite, bounded x/y coordinates, enums, payload size, and known problem IDs. Ensure submitted IDs are opaque and sanitized.
- Frontend shows human-readable validation; backend **always** validates independently using Zod.
- Remove UI-only flags, transient drag state and any unexpected properties when normalizing the DTO.
- No auto-save in P0; unsent edits can be lost on refresh. A confirmed submission is reloadable from PostgreSQL.

### 4.5 Canonical DTO

```ts
type ComponentKind =
  | "client" | "load_balancer" | "api_service" | "database"
  | "cache" | "message_queue" | "worker" | "object_storage"
  | "external_service" | "cdn";

type ArchitectureSnapshot = {
  schemaVersion: 1;
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: { componentType: ComponentKind; label: string };
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
};

type SubmitArchitectureRequest = {
  requestId: string;        // UUID; reuse on network retry
  expectedRevision: number; // 0 initially, 1 for permitted resubmit
  snapshot: ArchitectureSnapshot;
};
```

`type` on the React Flow *rendered* node is always `architecture`; the submitted canonical DTO carries the meaningful `componentType` separately.

### 4.6 UI paths

```text
apps/web/
  app/page.tsx                          # add mode selection
  app/interview/[id]/design/page.tsx    # initial design editor
  app/interview/[id]/page.tsx           # existing voice room
  components/system-design/
    DesignCanvas.tsx
    ComponentSidebar.tsx
    ArchitectureNode.tsx
    DesignSubmission.tsx
  lib/api.ts                            # typed mode/problem/design APIs
  types/interview.ts                    # mode and design state types
```

Do not add a second renderer for the challenge revision: render `DesignCanvas` in an interview-room panel while keeping LiveKit mounted.

---

## 5. Backend HTTP API and mode lifecycle

All public APIs use the existing bearer-token/ownership middleware and standard JSON error handling.

### 5.1 Problem catalog

`GET /api/v1/system-design/problems`

Response: `{ problems: [{ id, title, difficulty, brief, visibleRequirements }] }`. Never return `evaluationGoals`, internal probe rules or rubric answers.

### 5.2 Interview creation (backward-compatible)

`POST /api/v1/interviews`

```json
{"githubUrl":"https://github.com/example/repo"}
```

continues to create a GitHub interview. New request:

```json
{"mode":"SYSTEM_DESIGN","problemId":"notification-system"}
```

Use a discriminated Zod union (with an adapter for the legacy GitHub-only body). A system-design creation does **not** call GitHub scraping, and starts `created`, not `ready`.

Response: `{ interviewId, mode, status }`.

### 5.3 Load submission and problem

`GET /api/v1/interviews/:id/design`

Response includes `problemId`, visible problem info, `activeRevision` (0/1/2), latest **READY** snapshot or null, and `revisionAllowed` boolean. Never expose a failed/partially installed graph as active.

### 5.4 Submit architecture

`POST /api/v1/interviews/:id/design/submissions`

Body: `SubmitArchitectureRequest`.

201 first success / 200 idempotent replay:

```json
{
  "submissionId": "ds_123",
  "revision": 1,
  "graphStatus": "READY",
  "next": "START_INTERVIEW"
}
```

For revision 2: `next: "RESUME_INTERVIEW"`.

| Failure | Status |
|---|---|
| Malformed request | 400 |
| Missing/invalid browser token | 401 |
| Wrong owner / hidden interview | 403 or 404, matching existing policy |
| Old `expectedRevision`, wrong stage, conflicting request ID | 409 |
| Bad graph structure / size | 422 |
| FalkorDB unavailable / graph installation failed | 503 (retry same `requestId`) |

Only return `READY` when the graph is verified and the ready revision recorded in PostgreSQL.

### 5.5 LiveKit session / internal endpoints

Keep existing `POST /api/v1/interviews/:id/session`, `/internal/interviews/:id/start`, `/internal/interviews/:id/turns`, `/internal/realtime/events` with their existing authentication. Session readiness is now mode-dependent:

- `GITHUB`: existing `InterviewPlan + RepositoryKnowledge` readiness.
- `SYSTEM_DESIGN`: valid selected problem and revision 1 with graphStatus `READY`.

Do not start voice for an unsubmitted design. Do not redirect voice traffic to a new service.

### 5.6 Minimal interview status

Keep existing interview status enum when possible (`created`, `ready`, `active`, `completing`, `completed`, `evaluation_failed`, etc.). Maintain a **separate system design substate** inside versioned `InterviewRuntime.data`:

`DESIGN_PENDING → DISCUSSION → REVISION_REQUESTED → REVISION_REVIEW → FINISHED`

Creation/submission moves interview `created → ready`; live voice moves `ready → active`; ending moves `active → completing`; worker completion moves `completing → completed`.

---

## 6. PostgreSQL changes

### 6.1 Add mode without fake GitHub metadata

Current `Interview` has required `githubUrl`, `owner`, `name`; System Design does not have a repository. Make only these mode-specific fields nullable, then narrow accesses by mode.

```prisma
enum InterviewMode {
  GITHUB
  SYSTEM_DESIGN
}

model Interview {
  // existing columns and relations stay intact
  mode                   InterviewMode @default(GITHUB)
  githubUrl              String?
  owner                  String?
  name                   String?
  systemDesignProblemId  String?
  designSubmissions      SystemDesignSubmission[]
}
```

The snippet is an **additive sketch**, not a replacement for the real Interview model. Migrate old interviews to `GITHUB`. All GitHub paths explicitly require the three non-null repository fields. Add mode-specific guards to evaluation result formatting and session preparation.

### 6.2 Store immutable submitted revisions

```prisma
enum DesignGraphStatus {
  BUILDING
  READY
  FAILED
}

model SystemDesignSubmission {
  id             String            @id @default(cuid())
  interviewId    String
  interview      Interview         @relation(fields: [interviewId], references: [id], onDelete: Cascade)
  revision       Int
  requestId      String            @unique
  snapshot       Json
  snapshotHash   String
  graphStatus    DesignGraphStatus @default(BUILDING)
  graphError     String?
  createdAt      DateTime          @default(now())
  readyAt        DateTime?

  @@unique([interviewId, revision])
  @@index([interviewId, graphStatus])
}
```

- Revision 1: initial submitted design; revision 2: the one permitted revision after the challenge.
- Immutable `snapshot` and `snapshotHash`; retry uses the same stored snapshot, not a changed request body.
- Different payload with existing `requestId` returns 409.
- Latest `READY` revision is the only active graph. A failed revision 2 does **not** replace revision 1.
- Persist `submissionId`, selected probe, challenge ID, question ID, candidate turn evidence and design-diff summary using existing versioned runtime/event infrastructure; only add schema tables if existing JSON/event storage cannot express a required query.

### 6.3 Concurrency and durable completion

- Use `(interviewId, revision)` unique constraint plus expected revision for submission concurrency.
- Avoid holding the interview runtime lock throughout a network call to FalkorDB.
- Mark graph `READY` and publish active revision only after graph verification **and** re-check of interview stage; use CAS/version check where state can race with voice turn progression.
- Candidate's last acknowledged answer and the snapshot must be committed before evaluation is queued.
- Evaluation completion and retry stay distinct from interview end; display pending from stored status.

---

## 7. FalkorDB graph design and contract

### 7.1 System-design graph model

Use one logical graph, with every component and edge scoped by immutable **`submissionId`** (and interview/revision metadata). Simplify relations to candidate-drawn directional data flow, not invented semantic protocols.

```cypher
(:DesignComponent {
  interviewId: $interviewId,
  submissionId: $submissionId,
  revision: 1,
  componentId: "api-1",
  kind: "api_service",
  label: "API Server"
})-[:FLOWS_TO {submissionId: $submissionId, edgeId: "e-1"}]->
(:DesignComponent {
  interviewId: $interviewId,
  submissionId: $submissionId,
  revision: 1,
  componentId: "queue-1",
  kind: "message_queue",
  label: "Queue"
})
```

This block illustrates the stored *shape*, not a runnable parameterized mutation query. Insert through a tested FalkorDB client using parameterized values and only fixed code-defined labels/relationship names.

**What it means:** `FLOWS_TO` represents a candidate-drawn arrow (data/message flow), **not** proof of a runtime service dependency or that failure will propagate. Ask candidates to explain ambiguity; do not assert unsupported failure effects.

### 7.2 Build only after submission

1. Validate request and normalize snapshot in Hono.
2. Insert immutable `SystemDesignSubmission` with `BUILDING` in PostgreSQL (idempotent request ID).
3. Construct **this revision's** components and edges in FalkorDB. Prefer a single transaction/query on the pinned tested version; otherwise use deterministic idempotent batches.
4. Verify expected node and edge counts; reject missing endpoints or cross-submission links.
5. Mark `READY` in Postgres, making this specific revision visible to interview reasoning.
6. If graph construction fails, record `FAILED` and allow retry with the same request ID. Ignore partial failed graph in all reads.

PostgreSQL and FalkorDB **cannot share an atomic transaction**; the revision-ready publication gate plus idempotent rebuild handles the dual-write limitation. No BullMQ graph-sync queue for P0.

### 7.3 Mandatory Cypher query examples

**Components in an active submitted design:**

```cypher
MATCH (c:DesignComponent {submissionId: $submissionId})
RETURN c.componentId AS id, c.kind AS kind, c.label AS label
ORDER BY id
```

**Multi-hop path upstream of a provider; use for a failure *question*, not a failure assertion:**

```cypher
MATCH p = (source:DesignComponent {submissionId: $submissionId})
  -[:FLOWS_TO*1..5]->
  (provider:DesignComponent {
    submissionId: $submissionId,
    componentId: $providerId
  })
RETURN DISTINCT source.componentId AS upstreamId,
                source.label AS upstreamLabel
LIMIT 30
```

**Queue-to-worker relation candidates:**

```cypher
MATCH (q:DesignComponent {
  submissionId: $submissionId, kind: 'message_queue'
})-[:FLOWS_TO]->(w:DesignComponent {
  submissionId: $submissionId, kind: 'worker'
})
RETURN q.componentId AS queueId, w.componentId AS workerId
```

**Isolated components (optional clarification, not automatic defect):**

```cypher
MATCH (c:DesignComponent {submissionId: $submissionId})
WHERE NOT (c)-[:FLOWS_TO]-() AND NOT (c)<-[:FLOWS_TO]-()
RETURN c.componentId AS componentId, c.kind AS kind
```

Don't use a generic *zero-outdegree = bug* heuristic: providers and databases often terminate a flow legitimately. Verify Cypher syntax/integration against the chosen FalkorDB image version.

### 7.4 Deterministic probe selection

```text
active READY submission + problem config + interview phase + assessed concepts
 → bounded Cypher queries
 → normalized graph facts and candidate-drawn paths
 → application policy ranks a probe
 → LLM phrases ONE contextual spoken question
 → existing LiveKit worker speaks it
```

For Notification System, ordered probe options:

1. If `API → Queue → Worker` path exists, ask about acknowledgments/retries.
2. If a `Worker → External Service` path exists, ask about provider outages and pending messages.
3. If there is no apparent asynchronous buffer, ask about request latency and slow providers.
4. If arrows are ambiguous, ask candidate to explain the direction/meaning.
5. If graph is minimal, ask a general scaling question **without claiming topology facts**.

A selected probe record must include `probeId`, `submissionId`, `revision`, `referencedComponentIds`, `graphPath`, `questionId`, and candidate answer linkage. Record *why* the policy chose it for testing/observability.

**Not an open-ended LLM tool loop.** Graph traversal and probe selection are app-code decisions; LLM does only contextual phrasing and existing lightweight answer evaluation. Limit prompt size and retain current ~4-second per-model-call cap/fallback.

Before returning a referenced question to voice, re-check the active READY submission/version and referenced component IDs. If superseded or missing, recalculate or use a safe generic question.

### 7.5 GitHub project graph (second mode)

Build from the existing `RepositoryKnowledge` rather than re-scraping or re-introducing `GithubContext`. Use only **grounded, indexed** evidence.

Example entities/edges:

- `Repository -HAS_FILE-> File`
- `File -IMPORTS-> File` **only when resolvable** from actual indexed import paths
- `Repository -USES_TECH-> Technology` grounded in manifests/package metadata
- `File -IMPLEMENTS-> Concept` **only when supported** by specific code references; otherwise mark it uncertain / do not create it
- `Service -DEPENDS_ON-> Service` only if deterministic evidence exists; don't invent microservices from filenames

Properties: `interviewId`, `commitSha`, `sourcePath`, `lineStart`/`lineEnd` if known, confidence/source type. `RepositoryKnowledge` may be partial (24 selected text files in current README), so absence of an edge is **not** proof of absence in the full repository.

For hackathon implementation order, preserve existing GitHub interview first; the FalkorDB graph-enhanced probes are P1 after the System Design vertical slice and evaluation separation work.

---

## 8. Interview engine and agent behavior

### 8.1 Keep orchestrator in the backend process

Create **two strategies as modules** invoked by current `InterviewOrchestrator`:

```ts
interface InterviewStrategy {
  initialize(interviewId: string): Promise<void>;
  selectProbe(input: {
    interviewId: string;
    phase: string;
    latestAnswer?: string;
  }): Promise<SelectedProbe>;
  getQuestionContext(probe: SelectedProbe): Promise<unknown>;
}
```

The interface is illustrative: adapt to existing `QuestionGenerator` and `InterviewState` rather than reimplementing session runtime. `GitHubStrategy` keeps existing objective policy, adding graph evidence when enabled; `SystemDesignStrategy` uses fixed problem config and active FalkorDB submission.

The **existing orchestrator** continues to own deadlines, turn commits, lease/version locks, turn dedupe, phase policy, question persistence, recovery and finalization. Don't deploy `apps/orchestrator`, don't create a new auth boundary, and don't add a network hop between STT and the next question.

### 8.2 System Design interview phases

1. `INTRO`: greet, clarify candidate's stated design assumptions.
2. `ARCHITECTURE_DISCUSSION`: ask 2–4 core topology-grounded probes depending on answers/time.
3. `CHALLENGE`: present the one prepared requirement/failure scenario and request a revision.
4. `REVISION_REQUESTED`: await explicit submission or candidate decline; no questions about draft changes.
5. `REVISION_REVIEW`: compare READY revisions 1 and 2; ask at least one graph-grounded question about a change.
6. `FINAL`: conclude and enqueue evaluation intent.

Implement these as a mode substate, **not** wholesale replacements for existing runtime phases. Do not add a silent-canvas idle speech policy because the initial canvas is finished before voice starts.

### 8.3 Timing and fallback

- Keep current bounded live answer-analysis and question-generation request limits; do not add sequential LLM tool loops.
- Budget graph reads for fast local paths (engineering target p95 < 300 ms for seeded graphs, measure it), app probe selection < 100 ms, with a safe fallback if graph queries exceed budget.
- If FalkorDB becomes unavailable during live voice, ask a generic clarification grounded in the *last verified* problem requirements, not a made-up architecture claim; log the degraded mode.
- If revision 2 is still BUILDING/FAILED, keep revision 1 as active; do not ask questions about revision 2.
- If time expires during requested revision, end gracefully; do not mark “failed design” solely for not resubmitting.

### 8.4 Voice interface boundaries

`apps/voice-agent` owns Deepgram STT/TTS, LiveKit, microphone playback and interruption. It still calls backend authenticated internal routes and receives one proposed spoken question at a time. The backend owns final transcript event acknowledgement and durable candidate turns. Do not move the voice event journal/ack protocol to another service.

---

## 9. Redis + BullMQ evaluation design

**Problem being solved:** post-interview evaluation is slow. Move heavy evaluation LLM work out of the Hono API process, without risking loss when Redis is down. Redis is explicitly required but is **not** the canonical interview database.

### 9.1 Process boundary

```text
apps/web                 Next.js UI and results
apps/backend             Hono + interview strategies + PostgreSQL PREPARE/END/ANALYZE/VERIFY jobs
apps/voice-agent         Existing LiveKit voice worker
apps/evaluation-worker   NEW independent BullMQ EVALUATE worker

PostgreSQL               Interviews, transcripts, snapshots, evaluations, intent/outbox
Redis (noeviction)       BullMQ evaluation queue and retry metadata
FalkorDB                 Reasoning graph (own separate connection/service)
```

No new preparation or graph-sync queues for P0. The existing Postgres job system remains for everything **except** final evaluation execution until an intentional later migration.

### 9.2 Reliable enqueue without Redis dual-write loss

The current `InterviewJob` table already has a unique `key` and leases. **Reuse its `kind='EVALUATE'` row as durable PostgreSQL evaluation intent**, rather than introducing a second outbox table merely for this hackathon.

1. `END` processing transaction persists completed turns/session state, `completing`, and `InterviewJob(key='EVALUATE:<interviewId>')`.
2. A **backend-owned outbox relay** picks pending EVALUATE intent using a safe SQL claim/CAS lease (if multiple backend replicas, use `FOR UPDATE SKIP LOCKED` or equivalent lease CAS).
3. **Before dispatch**, ensure GitHub `ANALYZE`/`VERIFY` recovery prerequisites have completed via existing `prepareEvaluation`; if deferred, leave intent pending and retry later. For System Design, skip repository claim verification.
4. Publish BullMQ job with stable custom ID, e.g. `eval-<interviewId>-v1` (**no colons**). On Redis outage, keep PostgreSQL intent pending, retry relay later.
5. After acknowledged enqueue, mark PostgreSQL intent `dispatched` (add/allow this job state and re-dispatch reconciliation).
6. BullMQ worker loads transcript, selected problem, both submitted revisions, probe/challenge evidence, and current repository knowledge if in GitHub mode.
7. Worker evaluates and **idempotently upserts** the existing `Evaluation` record, then marks interview/evaluation complete and durable intent completed.
8. If the worker crashes after DB commit but before BullMQ ack, retry sees `Evaluation.status=completed` and exits safely.
9. Reconciliation periodically re-enqueues stale `dispatched` intents **only when DB evaluation is incomplete**, because BullMQ de-duplication is not a forever guarantee.
10. On bounded genuine evaluation failures, mark `evaluation_failed` and support the existing UI retry. Do not use Redis job presence as the only proof of status.

**Critical migration safety:** Modify the existing PostgreSQL `JobWorker` query to **exclude EVALUATE**, not merely delete its handler. Otherwise, the old poller may claim and fail a job that the BullMQ relay is also handling.

### 9.3 Evaluation worker responsibility

Keep evaluation in one app, e.g.:

```text
apps/evaluation-worker/
  src/main.ts               # BullMQ Worker with concurrency=1 or 2 initially
  src/evaluate.ts           # imports/reuses existing evaluator service
  src/observability.ts      # job attempt/errors/durations
```

Use current `EvaluationService` / `Evaluator` logic through shared modules or a direct workspace import refactor; **don't fork the scoring implementation**. Explicitly enforce appropriate timeouts, bounded retries, and model request size.

### 9.4 Evaluation output contract

- Common: technical depth, correctness, trade-offs, clarity of candidate explanations, concrete evidence/quotes, confidence, and `INSUFFICIENT_EVIDENCE` handling.
- GitHub: current architecture/debugging/implementation/claims rubric supported by transcripts and source references.
- System Design: requirements handling, architecture tradeoffs, reliability/scalability reasoning, explanation of submitted components, response to the outage challenge, and actual design changes if revision 2 exists.
- Report must explain **why**, with candidate-turn quote references and submission/probe IDs. Merely adding Redis or a queue does not guarantee a high score.
- Show `evaluation pending` from persisted state after interview end; don't block voice shutdown or page navigation on LLM scoring.

### 9.5 Redis configuration

- Use a dedicated Redis configured `maxmemory-policy noeviction` for BullMQ.
- Do **not** point BullMQ at FalkorDB's Redis-compatible protocol/instance.
- Reuse job IDs and PostgreSQL idempotency for duplicate dispatch, retries, and worker restarts.
- Start with evaluation worker concurrency **1** for predictable provider cost; increase only after measuring.

---

## 10. Repository file changes (minimal)

```text
apps/
  web/
    app/page.tsx
    app/interview/[id]/design/page.tsx          NEW
    components/system-design/                    NEW
      DesignCanvas.tsx
      ComponentSidebar.tsx
      ArchitectureNode.tsx
      DesignSubmission.tsx
    components/InterviewRoom.tsx                 PATCH to host revision editor
    lib/api.ts                                   PATCH typed endpoints
    types/interview.ts                           PATCH mode/design types

  backend/
    src/api/interviews.ts                        PATCH create/get mode
    src/api/system-design.ts                     NEW problem catalog/submission routes
    src/interview/orchestrator.ts                 PATCH mode dispatch
    src/interview/strategies/github.ts           NEW adapter around existing logic
    src/interview/strategies/system-design.ts    NEW graph probe policy
    src/system-design/problems.ts                NEW 10 static configurations
    src/system-design/validation.ts              NEW Zod canonical DTO
    src/system-design/submissions.ts             NEW PG persistence/revision safety
    src/system-design/graph.ts                   NEW FalkorDB client, install, queries
    src/jobs/queue.ts                            PATCH exclude EVALUATE from PG poller
    src/jobs/evaluation-relay.ts                 NEW DB intent -> BullMQ relay
    src/evaluation/evaluation.service.ts         PATCH mode-specific evaluation input
    src/server.ts                                PATCH routes/relay boot

  evaluation-worker/                             NEW
    src/main.ts
    src/evaluate.ts

  voice-agent/                                    PATCH only for mode-aware context, if needed

packages/
  db/prisma/schema.prisma                        PATCH models + migration
  types/src/                                    PATCH shared DTOs

spec/final-interviewer-spec.md                    THIS DOCUMENT
```

Preserve repository import conventions and existing package names; avoid unnecessary `packages/interview-core` extraction for P0. Share reusable evaluator modules only as needed to avoid duplicate implementation.

---

## 11. Deployment / development setup

### Local development

Continue existing Bun/Turborepo workflow with services:

- PostgreSQL (existing local or managed)
- FalkorDB (dedicated graph instance)
- Redis (dedicated BullMQ instance, noeviction)
- `apps/backend`, `apps/web`, `apps/voice-agent`, `apps/evaluation-worker`

Environment additions, names illustrative:

```env
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
FALKORDB_GRAPH=ai_interviewer
BULLMQ_REDIS_URL=redis://localhost:6380
EVALUATION_WORKER_CONCURRENCY=1
```

**Important:** Use different mapped ports/hosts for FalkorDB and ordinary Redis; actual ports depend on Compose. Don't reuse `localhost:6379` for both. Never expose internal bearer tokens through `NEXT_PUBLIC_*` vars.

### Existing CI/deploy impacts

The repo currently builds **three Docker images** and deploys behind Caddy on EC2. Add the evaluation-worker build/test/image and Redis/FalkorDB service configuration only **after the local vertical slice works**. Keep database migrations manual as required by the existing README. Check health, token injection, env propagation, shutdown behavior, and failure recovery. No Kubernetes, Kafka, Terraform, or new orchestrator deployment required for this hackathon.

---

## 12. Reliability, security, and correctness gates

### API / data

- Preserve owner checks on *every* design GET/POST and all interview/session endpoints.
- Never accept client-supplied `userId`, internal graph namespace, or `READY` status.
- Clamp labels/IDs, strip unknown fields, limit payload size, and use parameterized graph queries.
- Treat repository content, diagram labels, candidate statements, and any model output as **untrusted input**, not system instructions.
- Same `requestId` and same content must be idempotent; same ID with changed body is a conflict.
- Revision 1/2 unique; cannot submit revision 2 unless the challenge requested it; can only have one READY active revision.
- Do not mutate submitted snapshots. Graph build retry uses the saved JSON.

### Agent reasoning

- All named node/edge claims must refer to verified active graph evidence.
- Keep path traversal bounded (e.g., 5 hops), relevant to problem, and with limited result count.
- A flow path **does not prove** a specific outage impact; ask about consequences/mitigations instead.
- Don't score absence of a node as incorrect without considering spoken alternatives and trade-offs.
- Unexplored categories remain unassessed, not zero.

### Worker / recovery

- PostgreSQL finalization must succeed without requiring Redis availability.
- Backend stays responsive if evaluation worker or Redis fails.
- Worker retry may run same evaluation multiple times but only one final result is visible.
- A failed graph build cannot make the interview ready, and a failed revision 2 cannot erase revision 1.
- Reconnect restores the pending spoken question and most recent READY architecture via existing mechanisms.

---

## 13. Testing requirements (focused and executable)

**P0 tests**

1. Legacy `{githubUrl}` create request still succeeds; new `SYSTEM_DESIGN` creation does not call GitHub.
2. Wrong owner cannot read/submit another person's design.
3. React Flow add/rename/connect/delete serializes to valid canonical snapshot; missing endpoints rejected.
4. Repeated identical submission with same `requestId` returns same revision; changed retry returns 409.
5. Two concurrent `expectedRevision=0` submissions produce only one revision 1.
6. Simulated FalkorDB outage: submission not READY; same request ID can recover and retry.
7. `API → Queue → Worker → SMS` creates 4 nodes and 3 edges scoped to revision; multi-hop query returns upstream path.
8. Altering the submitted edges changes the deterministic selected probe (same problem and state).
9. Graph with sink/provider node is **not** automatically flagged invalid for zero outdegree.
10. Voice start rejects system-design interview without READY revision 1.
11. Revision request allows exactly one follow-up submission and does not unmount LiveKit.
12. Interview transcript is stored before analysis; duplicate final turn remains idempotent.
13. End request succeeds while Redis is down; evaluation intent survives and later dispatches.
14. Old PG job poller cannot consume `EVALUATE` after BullMQ cutover.
15. Worker crash after evaluation DB write does not create duplicate reports.
16. If no revision 2 is submitted, evaluator doesn't invent design changes or penalize automatically.

**Practical test approach:** Bun unit tests for validation, policy, idempotency and mode branching; a small real FalkorDB integration fixture for Cypher; a mocked LiveKit internal API contract smoke test; one manual end-to-end voice demo. Do **not** build a giant integration harness first.

**Observability:** record graph install time, graph read latency, selected probe ID, active submission version, question generation latency, evaluation queue age, worker attempts, and end-to-result duration; omit sensitive candidate transcripts and source excerpts from third-party trace metadata, matching current repo policy.

---

## 14. Implementation phases, ordered for hackathon value

### P0 — system design vertical slice (build first)

1. Add `Interview.mode`, `problemId`, nullable repo fields, and `SystemDesignSubmission` migration.
2. Add mode selection and problem catalog; support legacy GitHub creation without regressions.
3. Build constrained React Flow editor and **manual** `Submit Architecture` API.
4. Add synchronous submission-scoped FalkorDB install/verification and `READY` gating.
5. Add `SystemDesignStrategy` with deterministic multi-hop graph queries and question phrasing.
6. Integrate with existing LiveKit start/turn APIs and one Notification System challenge.
7. Implement one optional revision and review; complete an end-to-end demo.

**P0 success:** The hackathon's central graph functionality is working visibly and independently of evaluation queue refactoring.

### P1 — async evaluation with Redis + BullMQ (explicit requirement)

1. Keep existing `END`/`ANALYZE`/`VERIFY` PostgreSQL job behavior intact.
2. Exclude `EVALUATE` from PG job consumption; use its row as durable dispatch intent.
3. Build backend relay + BullMQ `evaluate` queue + independent evaluation-worker.
4. Preserve current evaluator, adapt inputs for System Design, and implement retries/reconciliation.
5. Update result page state mapping; run Redis outage and duplicate-evaluation tests.

### P2 — enrich existing GitHub mode with FalkorDB

1. Build evidence-grounded repo graph **from `RepositoryKnowledge`**, pinned SHA and imports/manifests.
2. Add mode-specific graph queries/probes; retain existing objective policy and code citations.
3. Test missing/partial index and uncertain relationships; ship without invented graph facts.

### P3 — finish the other nine prompts

Populate/version their configs (brief, requirements, clarification, challenge, rubric), test the shared canvas/policy against three representative problems (Notification System, URL Shortener, Chat Application), then all ten with light smoke cases.

**Do not build:** separate orchestration service, additional queue families, live graph sync, visual failure simulation, AI drawing/highlighting, collaborative editing, or cross-interview memory.

---

## 15. Demo script / judging evidence

1. Select **System Design → Notification System**; draw `API → Queue → Worker → SMS Provider`.
2. Submit and show architecture revision 1 acknowledged; backend uses FalkorDB traversal.
3. Speak with interviewer: it asks *why queueing* and *what happens to pending SMS on provider downtime*, grounded in the drawn paths.
4. Agent presents the **30-minute SMS provider failure** challenge.
5. Candidate revises/resubmits once; agent asks about the architectural change by comparing ready revisions.
6. End the interview immediately; show **Evaluation Pending**, then final evidence-backed score/report from BullMQ worker.
7. For technical proof in README/demo, show actual Cypher query results, logged selected `probeId`, and a test where **changing one edge changes the chosen probe**.
8. Briefly show existing GitHub interview mode still working; demonstrate a graph-grounded repository question if P2 is complete.

**Submission documentation:** Link original repository, point to feature commits made during the event, describe reused infrastructure vs. newly developed graph/canvas integration, include a real graph data model, executable queries, test instructions, deployment/local run steps, and an honest limitations section. Final eligibility follows the organizers' rules.

---

## 16. Explicit acceptance checklist

- [ ] Exactly two modes; legacy GitHub flow remains functional.
- [ ] Ten static problems present; Notification System fully demoable.
- [ ] Constrained React Flow editor; no live agent observations.
- [ ] Initial design submitted and saved immutably before voice begins.
- [ ] FalkorDB graph built, verified, and queried by interview policy.
- [ ] Deterministic probe selection; question references verifiable nodes/paths.
- [ ] One prepared challenge; optional revision 2; compare only READY revisions.
- [ ] Existing LiveKit worker and Hono internal auth remain intact.
- [ ] Candidate turns are durable before reasoning; reconnect continues to work.
- [ ] PostgreSQL durable EVALUATE intent, Redis/BullMQ, independent eval worker.
- [ ] Evaluation failure/retry works without blocking interview end.
- [ ] Tests pass for mode branching, Cypher traversal, graph recovery and queue retry.
- [ ] README/demo clearly explains what is new and why FalkorDB is essential.

---

## Appendix A — Rationale for changes from earlier proposed specs

- **Dropped separate `apps/orchestrator`:** it adds latency and shared-database complexity to an already working low-latency runtime.
- **Dropped live graph sync:** candidate finishes design before submission; there is no need to process every drag or build a `graphSync` queue.
- **Made graph selection deterministic:** app policy selects a graph-supported probe; LLM wording remains flexible, testable, and within latency budget.
- **Fixed graph relationship semantics:** one honest `FLOWS_TO` edge for directional data flow, bounded multi-hop traversal, and no zero-outdegree false positives.
- **Kept existing PG job pipeline for prep/recovery:** reduces migration risk; BullMQ is used explicitly for slow evaluation rather than immediately replacing all jobs.
- **Pinned one real scenario and one revision:** delivers a reliable demo instead of numerous shallow interview modes.

## Appendix B — Repository references

- [Repository README](https://github.com/Manav2209/ai-interviewer/blob/main/README.md)
- [Current improvement specification](https://github.com/Manav2209/ai-interviewer/blob/main/spec/improvement-spec.md)
- [Backend orchestrator](https://github.com/Manav2209/ai-interviewer/blob/main/apps/backend/src/interview/orchestrator.ts)
- [PostgreSQL job runner](https://github.com/Manav2209/ai-interviewer/blob/main/apps/backend/src/jobs/queue.ts)
- [Current evaluation service](https://github.com/Manav2209/ai-interviewer/blob/main/apps/backend/src/evaluation/evaluation.service.ts)
- [Prisma schema](https://github.com/Manav2209/ai-interviewer/blob/main/packages/db/prisma/schema.prisma)
- [Interview web room](https://github.com/Manav2209/ai-interviewer/blob/main/apps/web/components/InterviewRoom.tsx)

**End of final spec.**
