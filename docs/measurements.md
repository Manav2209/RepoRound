# Recorded measurements

[Project overview](../README.md#recorded-results) · [Development guide](development.md)

All figures below describe development runs recorded on **18 November 2026**.
They are observations from specific fixtures, model configuration and machine,
not a production SLO or a guarantee about the current head.

## Repository backend: live model

Each version processed six sequential scripted answers against a minimal repository
fixture with a warmed database pool. The timer covers answer processing, state and
event handling. Fixture creation and memory activation are outside the timer.
HTTP, STT, TTS, browser playback, completion flush and startup are excluded.

| Measurement                | Separate calls + PostgreSQL | Combined call + active memory |
| -------------------------- | --------------------------- | ----------------------------- |
| Samples                    | 6                           | 6                             |
| Median                     | 8,916.91 ms                 | 2,872.21 ms                   |
| p95                        | 12,117.62 ms                | 4,394.85 ms                   |
| Mean                       | 9,597.69 ms                 | 3,229.71 ms                   |
| Model requests per turn    | 2                           | 1                             |
| Assessment-schema failures | 2                           | 0                             |

Sources: [before](../spec/benchmarks/repository-live-before.json),
[after](../spec/benchmarks/repository-live-after.json).

The baseline includes two assessment-schema failures and their fallback paths.
The after run corrected confidence examples in the combined prompt and recorded
no assessment-schema failures. This comparison therefore includes both pipeline
and prompt changes. The latest decision-question preparation and live prompt
changes happened later and have **not** been re-benchmarked by these artifacts.
Six samples are too few to characterize a stable tail; with the implemented
nearest-rank calculation, p95 is the largest of six observations.

## Repository state handling: immediate model stub

This comparison keeps two deterministic, zero-network model stubs per turn and
changes active storage. It helps isolate database/state overhead from provider
latency; it does not estimate real model or voice response time.

| Measurement                    | PostgreSQL  | Active memory |
| ------------------------------ | ----------- | ------------- |
| Samples                        | 6           | 6             |
| Mean                           | 2,886.14 ms | 43.54 ms      |
| Median                         | 2,301.61 ms | 10.18 ms      |
| p95                            | 5,341.54 ms | 217.55 ms     |
| SQL statements per active turn | 26–27       | 0             |

Sources: [before](../spec/benchmarks/repository-db-before.json),
[after](../spec/benchmarks/repository-db-after.json). Setup and final persistence
still use PostgreSQL; zero active-turn SQL does not imply a database-free app.

## System Design: ten scripted rounds

The [controlled run](../spec/benchmarks/system-design-controlled.json) covered all
ten problems, with three scripted answers per round and a shared superset diagram.
It used the configured live model through the direct backend path.

- Candidate turns: **30**, median **1,980 ms**, p95 **2,675 ms**.
- All ten rounds completed with three questions and produced reports.
- All ten passed repeat handling, silent-checkpoint and raw-cleanup checks.
- Recorded candidate-turn model requests had no failures in this run.

The run excludes voice, browser networking, LiveKit dispatch, BullMQ delivery,
human drawing/answer time and the intentional startup wait. The fixture exercises
runtime contracts; its results do not establish how accurately the model grades
human candidates.

## Voice: one synthetic smoke test

The [voice artifact](../spec/benchmarks/repository-voice-smoke.json) records one
scripted speech-synthesis WAV published in real time to a LiveKit room, with real
STT, the configured backend model, TTS and voice worker.

- Candidate audio-source playout end to first received non-silent reply PCM:
  **6,082.69 ms**.
- Worker committed-turn to engine-speaking proxy: **5,446.14 ms**.
- Backend round trip: **4,127.11 ms**.
- Backend-ready to engine-speaking proxy: **1,303.80 ms**.
- Report generation and normal raw-data cleanup were verified.

These clocks have different boundaries and overlapping stages. Do not add the
stage figures together as a reconstructed total or compare this voice result
directly with backend-only p95. Received PCM is not proof of browser-audible
playback. One successful voice turn does not establish voice p95, and failed turns
must remain visible when assessing reliability.

## Local verification record

The local run before implementation commit
[`beddd72`](https://github.com/Manav2209/RepoRound/commit/beddd729c658453f44a77b235c114b99c0e1b87b)
reported **183 passing tests and 43 skipped integration cases** across backend,
voice and web unit checks. A separate targeted PostgreSQL run reported **23 passing
tests**, including prepared fallback, zero active-turn SQL, replay, cancellation,
completion retry, repeat controls, interview durations and retained metrics.
Backend lint and type checks passed. These runs overlap in test selection and
must not be added into a claim about unique test count. The counts are a historical
local verification record, not the result of a fresh CI run on every revision.

## Reproduce the backend measurements

Install dependencies, generate Prisma, and migrate a disposable database first.
Use a fresh database named `rr_metrics`; keep its connection separate from your
normal development data. Benchmarks create temporary account-owned fixtures and
clean them up. The live variants make real provider requests.

From `apps/backend`, set `DATABASE_URL` to that database and
`DATABASE_QUERY_EVENTS=1` to include SQL statement counts. For example, in PowerShell:

```powershell
$env:DATABASE_URL = 'postgresql://ai_interview:ai_interview@localhost:5432/rr_metrics'
$env:DATABASE_QUERY_EVENTS = '1'
$env:BENCHMARK_OUTPUT = '../../.turbo/repository-benchmark-latest.json'
bun run scripts/benchmark-db-state.ts --configured-database --memory --combined --live --samples=6
```

For the immediate-model state comparison, omit `--live` and `--combined`, and
compare runs with and without `--memory`. To exercise the legacy live path, omit
`--memory` and `--combined`. Use distinct output paths so historical artifacts
remain unchanged. These minimal fixtures do not assess the relevance of prepared
questions.

For the System Design run, point `DATABASE_URL` at the migrated disposable local
`rr_metrics` database, make FalkorDB available, then run from `apps/backend`:

```bash
bun run scripts/benchmark-system-design.ts --live
```

That harness rejects managed databases. Optional
`--problems=chat-application,url-shortener` limits its selection.

The [voice harness](../apps/backend/scripts/benchmark-voice-turn.ts) additionally
requires the app services, a real LiveKit connection and a PCM16 mono 48 kHz WAV
supplied through `BENCHMARK_AUDIO`; the original generated WAV is not checked in.
It requires both `--live` and `--configured-database`. Using different speech changes
the fixture and does not reproduce the historical sample exactly.

## How the product reports metrics

`GET /api/v1/metrics` returns an authenticated, account-scoped recent history.
Numeric summaries retain stage timings, failures, cancellations, retries, reported
token/audio usage and coverage. Missing usage or pricing remains unknown.

Percentiles use nearest rank: sort valid nonnegative finite durations, then select
index `ceil(n × p) - 1`. Failed and cancelled attempts are counted separately from
successful-duration percentiles; read those counts alongside latency.
`voice.response_start` is an engine-speaking proxy. Streaming STT usage duration is
not transcription latency.

Startup retains raw duration, the actual intentional wait and adjusted duration.
Only adjusted startup subtracts the recorded wait, normally ten seconds. Turn,
backend and model-call durations never subtract ten seconds.
