# Interview latency and reliability improvements

Status: proposed; implementation intentionally deferred. Merge the current
`experiment/repository-context` snapshot first. Start a new branch from the merged
base only after the user explicitly requests it. This document does not change
the running application's storage, model calls, or turn handling.

## Goal and scope

Reduce the time between a candidate finishing an answer and hearing the next
substantive question. Start with database/state overhead and cancellation, then
combine the repository interview's sequential model calls. Preserve repository
grounding, adaptive questioning, question limits, and accurate operational metrics.

The accepted tradeoff is that an interrupted/disconnected active interview may
be abandoned and replaced with a new interview. Durable per-turn recovery is no
longer required for the proposed mode. Successful completion must still persist
the data needed to evaluate the interview reliably.

Repository interviews remain 15 minutes. System design remains 30 minutes,
including drawing, with three substantive questions from its pinned problem bank.
System design already uses one answer-assessment model call and deterministic
question selection; do not introduce another question-generation call there.

## Current implementation and observations

The current repository pipeline is:

```text
Streaming STT + VAD
  -> finalized user turn
  -> backend session checks, runtime lock, database reads
  -> model answer analysis
  -> deterministic next-action selection
  -> model question generation
  -> database state/event commit
  -> complete JSON response to voice worker
  -> full question yielded to streaming TTS
  -> worker begins speaking
```

The custom voice `llmNode` delegates to the backend; it does not perform a third
model question-generation request. Backend model requests currently use
`stream: false`. Streaming input and streaming TTS therefore do not remove the
wait for the backend's complete response.

On November 18, 2026, one completed manual repository interview produced:

- One valid next-question response-start proxy of 11.844 seconds after the user
  turn was committed. This is a worker engine-speaking measurement, not the
  browser's first audible sample, and excludes prior turn-finalization delay.
- A 9.449-second backend round trip for that turn, with answer analysis taking
  3.457 seconds and question generation taking 1.982 seconds. The approximately
  4.009-second remainder includes all other request work; it is not an isolated
  database measurement.
- An approximately 2.395-second difference between committed-turn response start
  and backend round trip. Its exact scheduling, synthesis and playback components
  are not yet isolated. The associated TTS provider first-chunk measurement was
  429 milliseconds; do not add it to the gap as a separate non-overlapping stage.
- A successful repeat response-start proxy of 3.382 seconds. Keep this control
  request separate from substantive-answer latency statistics.
- Adjusted startup of 18.851 seconds after subtracting the measured intentional
  wait of 10.002 seconds from the raw 28.853-second startup.
- One turn exhausting four HTTP attempts, three observed retries, one voice
  error, and two cancelled response measurements.
- Report generation succeeding on its third attempt: the first attempt exceeded
  Prisma's five-second transaction timeout; the second encountered a busy lock.
- OTLP trace export failing because fractional millisecond values were passed
  directly to `BigInt`. Retained numeric metrics still survived raw cleanup.

Separately, six synthetic repository turns against the configured database, with
an immediate model stub and a minimal fixture repository, averaged 2.684 seconds
of non-model backend time (median 2.305 seconds, range 2.058-4.189 seconds). This
includes locks, reads, local state work, event writes and commits; it is not a
query-only measurement or a live voice benchmark. The reusable harness is
`apps/backend/scripts/benchmark-db-state.ts`. Its fixtures belong to a temporary
test account and are deleted after the run.

These samples identify investigation priorities, not production percentiles or a
guaranteed speedup. The controlled system-design benchmark in
`spec/benchmarks/system-design-controlled.json` has different methodology and
must not be compared directly with the manual voice sample.

## Proposed architecture

### 1. Active interview memory

- Load pinned repository facts, source references, objectives and runtime state
  once when the interview becomes active.
- Keep active conversation turns, question history, assessment/evidence memory,
  counters and telemetry in an account/session-scoped backend session object.
- Use bounded memory and an explicit inactivity/maximum-duration expiry. Evict
  completed, abandoned and deleted-account sessions, including cached private
  repository data. Never let one account's context enter another interview.
- Keep a lightweight per-interview mutex, version/epoch and idempotent turn IDs.
  Moving state to RAM does not permit concurrent turns to advance the same state.
- Start with one backend process. If several instances are needed later, require
  sticky session ownership or a shared store such as Redis; do not silently rely
  on each process having the same RAM contents.
- Migrate all readers and writers used by the mode together: turn processing,
  spoken-transcript events, pending-question/status routes, finalization, metrics,
  and, if enabled for system design, revision/checkpoint operations. Avoid mixed
  stale database state and current in-memory state.

### 2. Persist at completion

- On normal completion, freeze the active session and persist transcript, final
  state and numeric metrics before publishing the evaluation intent.
- Make the completion flush idempotent. A failed flush is retryable, must not be
  presented as a successful report, and must not discard the only active copy.
- Evaluation remains a separate background operation using persisted inputs.
- On disconnect, invalidate ownership/epoch and prevent late responses from
  reviving the session. Starting again creates a new interview ID. Make this
  behavior clear in the UI and do not advertise seamless reconnection.
- Keep already-durable interview/session allocation metadata so abandoned starts
  remain countable. Record abandonment and available numeric metrics on a best
  effort basis; explicitly disclose samples lost in a backend process crash.
- Decide the completed transcript's retention deliberately. Current code deletes
  raw data after report creation; changing active-session persistence does not
  automatically authorize indefinite transcript retention or duplicate archives.
  Preserve report/account deletion behavior and document any retention change.

### 3. One repository model request per normal answer

The model returns compact structured data for the answer assessment, a proposed
next question (including its allowed target/action), and a bounded memory update.
Do not regenerate the whole interview document on every turn.

The backend continues to own phase/objective selection, timing, difficulty
bounds, follow-up budgets and completion. Compute the legal next targets before
the request and validate the returned proposal against the action selected after
applying the assessment. If that target is incompatible, use a grounded prepared
fallback; do not silently move state-machine authority into the model or add a
second model call to every turn. Benchmark whether a small set of legal question
options is preferable to one proposal plus fallback; extra output has a cost.

Prompts contain trusted interview rules separately from untrusted context data:
the prepared project brief, bounded relevant excerpts, current objective,
assessed earlier reasoning and recent turns. Distinguish candidate claims from
verified source facts. Preserve the original answers for final evaluation.

Markdown may be a readable representation or export of this state. It is not
automatic model memory. The backend supplies context and applies model-proposed
updates; file-editing tool calls and duplicate file/database writes must not be
inserted into the response path.

Keep local checks for response shape, allowed objective/action, repeated
questions, source-reference validity, spoken length and time/question limits.
These do not require a separate LLM validator. Never speak raw JSON or private
assessment fields. A combined request can take longer than either old request
individually; the savings must be measured.

### 4. Cancellation, interruption and retries

- Propagate turn cancellation from the SDK through worker requests and, where
  supported, model requests. An HTTP abort alone does not prove server work or a
  state commit stopped.
- Attach session epoch, turn ID and expected state version to work. Before
  applying results or speaking, reject stale/superseded work.
- A replay of an accepted turn returns its prior result without another model
  request or duplicate question/answer. Transient retries keep the same identity.
- Test resumed speech, fragmented transcripts, interruptions, repeated transport
  delivery, late model responses, failed requests and interview abandonment.
- Preserve correct repeat-question handling and do not count controls as answers.
- Fix cancellation correctness before enabling speculative/preemptive generation.
  Current requests mutate interview state and cannot be speculated safely as-is.

### 5. Voice handoff and turn detection

Measure timestamps for turn commitment, custom LLM-node entry, HTTP dispatch,
backend result availability, text handoff, TTS request/first frame and browser
playback. Correlate them by turn and speech identity to locate the worker gap.

Keep streaming TTS. Consider question-text streaming only after state ownership
and cancellation are correct; validate speakable content before handing it to TTS.
Never stream an assessment or synthesize a question that has already been rejected.

The current endpointing minimum is one second and VAD silence is 550 milliseconds.
These settings overlap rather than necessarily adding together. Evaluate shorter
delays separately using real answers with thinking pauses and interruptions;
reducing silence thresholds must not cut off answers. Preserve the deliberate
10-second startup wait unless the user separately changes that requirement.

### 6. Report and observability reliability

- Convert fractional milliseconds into integer nanoseconds safely when creating
  OTLP timestamps; cover fractional values and preserve span ordering in tests.
- Profile and shorten report commit work. Set an explicit, justified transaction
  budget and keep external model calls outside it. Test timeout/rollback/retry
  behavior and avoid rerunning a committed evaluation.
- Retain numeric timings and usage across cleanup, including failures,
  cancellations and retries. Distinguish transport/model success from schema or
  policy rejection and from successful report persistence.
- Batch diagnostic events or collect them in active memory; do not await an
  individual remote database write for every tool/trace event before responding.
- Keep raw startup and measured intentional delay separately. Subtract the delay
  only from adjusted startup, never from ordinary turn/model/provider durations.

## Measurement and acceptance

Product goals, to validate rather than claim in advance:

- Typical end-of-speech to first audible next-question latency: median at most
  three seconds and p95 at most five seconds over at least 100 representative
  turns. Track the existing worker-speaking proxy separately.
- Target active-state/context overhead below 200 milliseconds per normal turn;
  measure this independently of model, turn-finalization and speech synthesis.
- Normal repository answers use one model request; repeats use none. System
  design retains its single assessment request and deterministic question bank.
- No duplicated questions/answers or stale speech after cancellation/replay.
- Completed interviews durably flush before evaluation; report retry and deletion
  semantics work under failures. Abandonment behavior matches the accepted policy.

First preserve a baseline with the same fixture, model, region, prompt budget
and machine. Compare database/state changes with an immediate model stub; compare
combined model calls with real providers; then run real voice interviews. Report
sample counts, medians/p95s, errors, retries, cancellations, token/audio usage and
coverage gaps. Include slower and failed attempts rather than only ideal turns.
Never compare the direct-backend benchmark with end-to-end audio as if they were
the same metric. Cost remains an estimate unless provider rates and usage are known.

## Implementation order after merge and explicit instruction

1. Create a fresh branch from the merged base; retain current baseline artifacts.
2. Fix trace export and add missing stage measurements; stabilize cancellation
   ownership and retries.
3. Introduce the active-session store and idempotent completion flush, migrating
   the mode's readers/writers together; benchmark database/state savings.
4. Combine repository assessment/question generation and validate fallback quality.
5. Investigate the remaining voice handoff gap; only then test streaming and
   endpointing changes separately.
6. Run replay/abandonment/deletion/failure tests and at least 100 voice turns before
   publishing a performance claim. Update the spec with measured outcomes.
