# Interview memory: PostgreSQL and FalkorDB

**Status:** Proposed; no runtime changes in this document  
**Updated:** 22 October 2026  
**Scope:** Interview-scoped memory, retrieval, recovery, and post-evaluation retention

This spec replaces the interview-memory and retention design in section 4 and the corresponding acceptance checks in section 5 of `landing-auth-memory-spec.md`. Its landing-page and authentication decisions are unchanged. RepoRound will use **PostgreSQL and the existing FalkorDB deployment only**. Do not introduce Mem0, a separate vector database, or per-interview Markdown files as live memory. This is a design decision for the current phase, not a claim that FalkorDB must answer every question.

## 1. Desired behavior and current gap

During a GitHub or system-design interview, the interviewer should recall an earlier, relevant candidate answer, identify its source, and ask a grounded follow-up without delaying the voice exchange. It should resume correctly after a worker restart or FalkorDB outage. After a durable report is created, temporary interview memory and raw interview records should be deleted.

Today `InterviewRuntime.data` in PostgreSQL already contains objectives, claims, evidence, question history, processed turn IDs, phase, and system-design progress. `ConversationTurn` contains the exact answers, and `SystemDesignSubmission.snapshot` contains the submitted design. The turn handler loads the runtime before choosing the next question. However, the GitHub question generator currently passes only the last four claims and last four evidence items to its prompt. Selecting relevant facts from the **already loaded runtime** is the first improvement; it needs no network retrieval call. FalkorDB currently stores the immutable submitted design topology, scoped by submission ID. It does not hold general candidate memory yet.

## 2. Storage boundary

| Data                                                                                           | Primary store while interview is active or retryable | After report is committed                                                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Account identity and sign-in records                                                           | PostgreSQL                                           | Keep until account deletion                                                               |
| Interview owner, mode, lifecycle status, timestamps, and progress                              | PostgreSQL                                           | Keep only a minimal report lookup/cleanup record; remove raw interview tree               |
| Exact, ordered candidate and interviewer turns                                                 | PostgreSQL                                           | Delete after evaluation can no longer be retried                                          |
| Runtime snapshot: objectives, phase, questions, deduplication, claims, evidence                | PostgreSQL                                           | Delete                                                                                    |
| Submitted design snapshot and repository knowledge needed for evaluation                       | PostgreSQL                                           | Delete                                                                                    |
| Small evaluation dispatch intent, retry status, and cleanup intent                             | PostgreSQL                                           | Delete evaluation intent after completion; keep cleanup intent until every store is clean |
| Searchable candidate-fact and relationship projection; submitted design topology               | FalkorDB, scoped to interview/submission             | Delete                                                                                    |
| Final score, dimensions, feedback, coverage, and deliberately retained short evidence excerpts | Independent account-owned PostgreSQL `Report`        | Keep until the user deletes it or the account                                             |

PostgreSQL is the recoverable source. FalkorDB is a queryable projection, never the only copy of an answer, fact, submitted design, or state transition. The final report is not fed into a later interview. No cross-interview candidate profile is part of this phase. Do not put audio, full turns, whole prompts, account credentials, or email addresses into FalkorDB. Do not create Markdown files per interview; files complicate concurrent writes, ownership checks, cleanup, and recovery without helping the existing hot path.

## 3. Fact contract

Represent each short memory item as a structured fact with a stable fact ID, interview ID, source turn ID, question ID, objective/topic, concise text, observed time, provenance (`candidate_answer`, `repository`, or `design_submission`), confidence, and verification status (`candidate_claim`, `supported`, `contradicted`, or `uncertain`). Keep candidate statements separate from repository facts and diagram topology. Repository content or a drawn arrow never proves that the candidate understands a subject. An absent fact in a partial repository index is not a contradiction.

Reuse the current answer analyzer, `CandidateClaim`, `CandidateEvidence`, and objective rules. Avoid a second unconstrained extraction pass that can produce conflicting interpretations. Record a compact canonical fact ledger with the runtime, retaining source IDs and updates to status. A repeated turn or worker retry must not duplicate a fact. Use stable IDs based on the committed turn and fact position or a persisted generated ID, rather than generating a fresh ID during projection retries. Bound text length and facts created per turn; do not retain raw answers in a fact summary.

For reconstructing the **current runtime after an ordinary process restart**, load its versioned PostgreSQL snapshot and the relevant exact turns and submitted snapshot. For reconstructing it if that snapshot is damaged or missing, record compact, ordered analysis and state-change data sufficient to replay objective transitions, generated question IDs and text, claim/evidence status, processed-turn decisions, and design revision decisions. The existing domain events mostly carry identifiers, so they are not sufficient on their own for exact replay. Do not claim that FalkorDB or a memory summary can rebuild the state. If a full replay log is too costly in the first increment, make snapshot-loss recovery an explicit unsupported case until it is implemented and tested.

## 4. Write and retrieval paths

1. Persist each finalized candidate turn with its stable turn ID before analysis. Preserve the existing turn deduplication and runtime lease/version checks.
2. Analyze the answer once under the existing interview lease. For the immediate follow-up, select relevant facts from the updated runtime already in memory, including facts just extracted from this turn. Filter by interview and current objective/action, then rank by topic match, source/verification quality, recency, and whether the fact has already been probed.
3. Pass only a small, bounded set of fact summaries plus status and source turn IDs to question generation. Preserve recent turns and repository excerpts where needed. The backend's objective policy still chooses the action and phase; retrieved facts may inform wording, not control progression or scores. Never turn an unverified claim into an asserted truth.
4. Commit the updated runtime, generated question/processed-turn decision, canonical fact changes, analysis outcome, and any projection intent in a PostgreSQL transaction under the lease/version check **before returning the question**. This follows the current generate-then-save ordering and keeps turn retries deterministic. Do not require a FalkorDB write to commit the turn or ask the next question.
5. Project committed facts idempotently into FalkorDB after the PostgreSQL commit. Use an interview-scoped graph schema distinct from immutable `DesignComponent`/`FLOWS_TO` submission topology. Use code-defined labels/edge types, parameterized queries, indexes for scope and topic, and stable fact IDs. A PostgreSQL outbox/intent or reconciliation pass must repair missed writes. Graph reads and writes must never cross interview or account ownership boundaries.
6. Add bounded FalkorDB retrieval only for cases where relationships or older facts measurably improve follow-ups beyond runtime selection. Do not invoke a new extraction model or embedding request on every live question. A graph timeout, stale projection, or missing graph returns to the runtime selector without blocking the voice path. A graph result is usable only if its fact ID and source still match the canonical interview state.

Treat speed as a measured product constraint, not an assumed advantage of a graph or memory library. Instrument fact-selection time, graph-read time and timeout rate, facts returned/used, prompt size, and whether an older fact led to a useful follow-up. Set a strict graph deadline below the question-generation deadline, and cap graph queries, returned facts, fact writes, and prompt characters. Benchmark the runtime-only path first; enable graph retrieval only if it improves grounded follow-up quality without materially worsening tail latency. Avoid duplicating the whole transcript in any prompt or index.

## 5. Failure and recovery

- **Worker restart or reconnect:** Reload the versioned PostgreSQL runtime, finalized turns, and current design submission. Preserve processed-turn IDs so a repeated callback returns the same question rather than reanalyzing an answer.
- **FalkorDB outage or lag:** Continue with the in-memory runtime selector. Leave the projection intent pending and reconcile it later from PostgreSQL. Never make graph availability a prerequisite for ending or evaluating an interview.
- **PostgreSQL/graph write disagreement:** PostgreSQL wins. Rebuild or delete graph facts by interview ID and stable fact ID. Do not infer that an unprojected fact was never said.
- **Runtime snapshot loss:** Recover only when the structured replay record described above exists and passes version/order checks. Mem0-style summaries or a graph traversal are not substitutes for exact control state.
- **Evaluation retry:** Retain exact turns, runtime, design snapshot, and durable evaluation intent until evaluation and report creation have completed. The current evaluator reads the transcript and sourced evidence; deleting them earlier would make grounded retry impossible.

## 6. Report and deletion boundary

Create an account-owned `Report` independent of `Interview`. Copy only the final score, dimensions, strengths, weaknesses, feedback, coverage warning, mode, completion time, and the short evidence excerpts intentionally displayed to the user. The report's former interview ID or a durable mapping must keep existing result links working after cleanup. The account UI must let the user view and delete reports. Update the result page to render report excerpts without calling a deleted transcript endpoint.

Only after the report and ownership are committed, start idempotent cleanup of raw turns, runtime and fact ledger, plan, repository knowledge, submitted snapshots, sessions, evaluation jobs, events, voice outbox entries, and all interview-scoped FalkorDB memory and topology. Do not clean interviews whose evaluation is pending, failed, or retryable. Keep a cleanup intent outside the interview tree until PostgreSQL and FalkorDB deletion both succeed, then reconcile interrupted cleanup. Account deletion uses the same mechanism. Update the privacy page to state the actual deletion behavior, including backup expiry and the retained report excerpts; do not claim automatic deletion before this phase ships.

## 7. Delivery order and acceptance checks

1. **Baseline retrieval:** Replace last-four-facts prompt selection with deterministic, bounded, source-aware selection from the loaded runtime in both interview modes. Record latency and follow-up quality before adding graph retrieval.
2. **Canonical facts and recovery:** Add stable fact IDs, compact canonical ledger, projection intent, and versioned replay data if full snapshot-loss recovery is required. Verify deduplication and same-question behavior on turn retry.
3. **Falkor projection:** Add interview-scoped fact relationships without modifying submitted topology. Test idempotent writes, graph outage, lag, rebuild, cross-interview isolation, and deletion. Enable graph retrieval only after measured benefit.
4. **Durable report and cleanup:** Migrate evaluation into an independent report, adapt result/account APIs, add report deletion and idempotent raw-data/graph cleanup, then update privacy copy.

Acceptance requires: an earlier relevant answer can influence a later grounded follow-up; unsupported claims remain marked as claims; normal restart and duplicate turns preserve exact state; a graph outage does not lose or stall the interview; evaluation can retry from exact source material; and a completed evaluation leaves an accessible report but no raw transcript or interview graph after cleanup. Test these locally before deployment. This spec authorizes no implementation or deployment by itself.
