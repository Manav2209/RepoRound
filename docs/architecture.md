# Architecture and runtime reference

[Project overview and architecture diagram](../README.md#architecture) · [Development guide](development.md)

This reference covers interview progression, storage, graph behavior, evaluation and access controls.

## Response latency

By default, a repository interview's final candidate turn follows:

```text
STT → record answer in active memory → combined assessment/question proposal → local policy checks → TTS
```

The combined repository request has a 6.5-second limit and one attempt. Invalid proposals use a source-grounded local fallback without another model call; failed assessment keeps the answer for later recovery. Active context and state stay in backend memory until completion, when the transcript, state and evaluation intent are saved. System Design retains one assessment request and its deterministic question bank. Legacy separate repository requests retain their four-second limits. These limits bound model requests; they are not a guarantee of total end-to-end latency. Measurements and remaining targets are in [spec/interview-latency-improvement-spec.md](../spec/interview-latency-improvement-spec.md).

Detailed repository claim checks, failed analysis recovery, and scoring run after the interview:

```text
END job → recover pending analysis → VERIFY jobs → EVALUATE intent → Redis/BullMQ → evaluation-worker → result
```

The `EVALUATE` intent is a durable PostgreSQL row, not the work itself. A dispatch relay in the backend publishes it to the `evaluate` BullMQ queue with a stable job id (`eval-<interviewId>-v1`) and marks it dispatched; the PostgreSQL job poller excludes `EVALUATE` so a single owner consumes each intent. The `apps/evaluation-worker` process performs the model calls and writes the evaluation. Because the intent is durable, a Redis outage or a crashed worker leaves it recoverable: the relay re-queues stale dispatched intents during reconciliation, and the result page keeps polling. Exhausting the bounded retries marks the interview `evaluation_failed`, which the result page surfaces with a retry action.

Claim verification checks whether fetched code supports or contradicts a factual statement. Missing code in a partial index is not a contradiction. Repository implementation alone never demonstrates candidate competence.

## State and recovery

- Repository rounds use objective plans with prepared decision questions; System Design uses its pinned three-question bank. Each question records its objective, phase, difficulty, reason, and code references when available.
- Default repository sessions record final answers in memory before reasoning and persist them at completion. System Design and legacy sessions persist answers before reasoning. Stable turn IDs deduplicate retries; memory sessions use per-turn ownership and cancellation, while durable sessions use runtime leases and version checks across backend processes.
- A GitHub interview clock starts when the voice session is allocated. A System Design clock starts when the interview is created, and reconnect or transient startup gaps before the voice session are credited back. System Design retains durable runtime recovery; default GitHub sessions keep active state in a single backend process and require a fresh interview after disconnection or lost backend memory.
- Session allocation is serialized in PostgreSQL. The session row exists before LiveKit dispatch.
- System Design and legacy database-backed GitHub sessions retain the configured reconnect window. Default memory-backed GitHub sessions show a new-interview action after disconnection. Their available transcript is flushed before background evaluation; a backend process crash can lose unflushed turns, an accepted tradeoff for this mode.
- The browser End action immediately stops further progression. Finalization and evaluation use unique durable job keys, expiring leases, and bounded retries.
- Failed evaluations can be retried from the result page while their raw source material is retained. A completed report is final.
- PostgreSQL jobs allow four total executions, including the initial attempt; lock contention and intentional deferrals do not spend that budget. BullMQ evaluation retries have their own policy.
- Voice events are journaled until the backend acknowledges them. For durable recovery across container replacement, mount `VOICE_OUTBOX_DIR` on persistent storage. Its default OS temporary directory covers process restarts on the same host.

## Repository knowledge and limits

Only HTTPS GitHub repository URLs are accepted. Fetches are pinned to a commit SHA. The index contains up to 1,500 paths and 24 selected text files, a 120,000-character total source budget; the diverse sampler can extend initial 10,000-character file prefixes using the remaining budget. Repositories over 100 MB are rejected. This is a partial index, not a full code audit.

Read tools expose project context, architecture, bounded file excerpts, lexical symbol lookup, code search, dependency lookup, candidate state, and the current objective. Code references include path, commit SHA, and line range. Symbol lookup uses lexical declarations rather than a language-specific AST. Dependency lookup currently supports `package.json`; other manifests contribute to repository analysis and can be inspected with file/search tools.

GitHub mode also derives an **evidence-only repository graph** from `RepositoryKnowledge`, pinned to the analyzed commit SHA. Edges are limited to facts provable from the index: `IMPORTS` between indexed files (a relative specifier resolved within the index, with its line), `IMPORTS_MODULE` for bare imports a file literally declares, and `DEPENDS` for manifest dependency keys with their version. A relative import whose target is not indexed produces no edge, and a truncated manifest produces no dependency edges. Objective questions may cite graph-grounded facts (for example, a module and its indexed importers); when the index cannot support a fact, no relationship is asserted.

Repository analysis and indexed source excerpts are stored together in `RepositoryKnowledge`. The consolidation migration copies legacy `GithubContext` analysis into that record before dropping the duplicate table. Existing source indexes and richer analysis are preserved. The unused `Interview.systemPrompt` and `InterviewPlan.questions` columns are removed; actual question history remains in interview runtime state.

Repository text and candidate answers are untrusted data. All structured model outputs are validated with Zod. Model-proposed tools cannot directly mutate interview state. Limits include 40 questions, five tool calls per registry operation, 200 tool calls per interview, 60,000 input characters per model request, and bounded output tokens.

## System Design graph (FalkorDB)

System Design mode uses FalkorDB as its topology layer. PostgreSQL remains the source of truth for the interview and the submitted snapshot; the graph is a rebuildable projection used to choose questions. Each accepted canvas snapshot is installed under an immutable `submissionId`, so no two revisions share nodes or edges. The GitHub repository graph described above is a separate, in-memory evidence-only structure and is not stored in FalkorDB.

Interview-scoped candidate facts are also projected to `InterviewFact` nodes in FalkorDB, separately from `DesignComponent` topology. Short summaries and source turn IDs are derived from the canonical PostgreSQL runtime after durable commits, including the completion flush for memory sessions. The question path selects facts from its active runtime; graph fact retrieval is disabled until local measurements show a clear benefit. A graph outage leaves the projection pending and does not block questions or evaluation. A missing or corrupt runtime snapshot cannot currently be replayed from a full event log.

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
4. Only `READY` submissions are read by the interviewer. Revision 1 starts the discussion. After each substantive answer the candidate can submit one revision for that checkpoint and then continue; every revision is independently installed and diffed for evaluation.
5. The timer starts when the interview row is created. Voice-session startup and reconnect gaps are credited back, and the interview reserves time for the failure scenario and final edit.

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
- **Deterministic probe selection** (`selectProbe`): application policy, not an LLM tool loop. It selects from the active problem's technical probes using the submitted topology and avoids probe IDs already asked. New rounds have three substantive slots: an opening flow question, one relevant technical decision, and the scripted failure challenge last. Missing or alternate components call for a question about the required guarantee, not an invented topology fact or a prescribed product.
- **Checkpoint flow**: each substantive answer records an assessment and opens a silent UI checkpoint. The canvas offers an optional edit or continuation; the voice worker does not recite that menu as another interview question. A checkpoint resolves only when the active revision is `READY`; an unchanged snapshot is a no-op. A targeted clarification, when necessary, stays within the same substantive slot.
- **Explainability**: every probe records `probeId`, `submissionId`, `revision`, `referencedComponentIds`, `graphPath`, and a human-readable `reason`; the selected probe is also written to `system_design.probe` interview events. Question wording is generated from those facts, and accepted revisions are compared with a deterministic node/edge diff, so evaluation can trace how the architecture changed.

Configuration: `FALKORDB_HOST` (default `localhost`), `FALKORDB_PORT` (default `6379`), `FALKORDB_GRAPH` (default `ai_interviewer`), and `SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES` (default `30`, validated from `10` to `30`). The product uses a flat 30-minute system design round with three core questions, not a duration selector. Repository rounds retain their separate 15-minute default. Read queries use a 400 ms timeout and writes a 5 s timeout; a failed connection is reset and re-established on the next call.

## Evaluation

The evaluation includes technical depth, architecture, debugging, implementation, tradeoff reasoning, and communication. Final grading reads the recorded candidate answers directly, including adjacent speech fragments, instead of trusting speculative live summaries. Every assessed category includes a numeric score, confidence, and quotes checked against the originating candidate turns. Confidence expresses certainty of the assessment, not candidate ability: a clearly weak answer can receive a low score with high confidence. Unsupported categories and scores remain `INSUFFICIENT_EVIDENCE` / `null`; pipeline failures and unexplored objectives are not candidate weaknesses. Overall and dimension scores are calculated from assessed categories, excluding unassessed areas.

The responsive result view includes a skill breakdown, short supporting answer quotes, and session details. A completed evaluation creates an independent account-owned report. Once its durable evaluation intent settles, the backend removes the raw transcript, runtime, repository knowledge, design snapshots, and interview-scoped FalkorDB data through a retryable cleanup intent. Numeric operational metrics are retained separately without candidate text. Reports can be viewed and deleted from the account page; deleting a report also deletes its retained metrics, and account deletion cascades through all of that account's metrics.

Evaluation reads every transcript page. Candidate answers share the model input budget, retaining both the beginning and end of long answers. The completion event records included, omitted and shortened candidate-turn counts. Partial coverage is shown in the result view and feedback, with confidence capped at 0.65; omitted content is not evidence of a weakness. Older assessments without coverage metadata remain readable.

## Access and security

RepoRound requires an email/password account with a verified email. Better Auth runs at `/api/auth/*`, stores sessions in PostgreSQL, and issues HttpOnly `SameSite=Lax` cookies scoped to the app origin. Passwords are hashed with Argon2id. Session tokens are stored as an HMAC-SHA256 digest, so a database read cannot be replayed as a browser session. Cookies are `Secure` when `BETTER_AUTH_URL` uses HTTPS.

Interviews belong to the authenticated account; every public interview operation checks ownership on the server. The API never accepts a user ID from the browser. Sign-up, sign-in, resend-verification, and password-reset requests are rate limited per client IP. Password changes and resets revoke existing sessions. Google and GitHub sign-in are enabled only when both provider credentials are configured; implicit email-based account linking is disabled.

Accounts can be deleted from `/account`. Deletion removes remaining interview fact and design graph data first, then cascades through reports, interviews, sessions, and linked provider accounts. If graph cleanup fails, account deletion stops for a retry. The authentication migration intentionally deletes pre-auth anonymous browser sessions and interviews instead of guessing an owner.

The voice worker uses a separate internal bearer token and must supply a session belonging to the interview. The browser never receives server credentials or the internal token. Rate limits cover interview creation, public operations, internal events and candidate turns. Active memory sessions use process-local turn/event budgets; durable operations use database-backed buckets.

EC2 deployment generates a separate proxy credential for Caddy and the backend. Caddy overwrites the client-IP and proxy-credential headers; the backend accepts that client identity only when the credential matches. Other forwarding headers are ignored. This configuration assumes browsers connect directly to Caddy; adding a CDN requires configuring its trusted client identity at the proxy boundary. Unexpected API failures return a generic error and a server-generated request ID.
