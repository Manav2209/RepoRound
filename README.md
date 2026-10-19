# RepoRound

**Real code. Real architecture decisions. A technical interview that asks better follow-up questions.**

[![CI](https://github.com/Manav2209/RepoRound/actions/workflows/ci.yml/badge.svg)](https://github.com/Manav2209/RepoRound/actions/workflows/ci.yml)
![Bun](https://img.shields.io/badge/runtime-Bun-111111)
![Next.js](https://img.shields.io/badge/frontend-Next.js-111111)
![Status](https://img.shields.io/badge/status-pre--production-orange)

RepoRound is a voice-first technical interview practice platform. Instead of relying only on generic questions, it interviews developers about **their own GitHub projects** or a **system design they build on a canvas**. A backend orchestrator manages the interview, persists answers, asks adaptive follow-up questions, and produces evidence-backed feedback from the actual conversation.

> **Current stage:** Pre-production. Automated checks, Docker images, and an EC2 deployment path exist, but successful builds are not proof of production reliability or security. See [Checks](#checks), [Access and security](#access-and-security), and [EC2 deployment](docs/ec2-deployment.md) before public launch.

## Features

| | Capability | What it does |
| --- | --- | --- |
| 🧑‍💻 | **GitHub project interviews** | Analyze a public repository at a pinned commit, ask code-specific questions, and validate factual claims against indexed evidence. |
| 🏗️ | **System design interviews** | Choose a design challenge, draw a component/flow graph, discuss bottlenecks, and optionally revise the architecture after a failure scenario. |
| 🎙️ | **Real-time voice** | Use LiveKit, Silero VAD, and Deepgram for spoken interviews with interruptions and session reconnection. |
| 🧠 | **Adaptive interview engine** | Select phases, objectives, difficulty, and follow-ups through application-defined policies with model-assisted question generation. |
| 📊 | **Evidence-backed results** | Evaluate recorded answers asynchronously, with category scores, confidence, candidate quotations, and an insufficient-evidence state. |
| 🔄 | **Durable workflows** | Persist interview state and evaluation intent in PostgreSQL; dispatch asynchronous evaluations through Redis/BullMQ. |

## Architecture at a glance

```text
Next.js candidate UI ───── HTTP ─────> Hono API ─────> PostgreSQL + Prisma
         │                              │                    │
         │                              ├── GitHub analysis   └── Interview state
         │                              ├── Model API             and evaluation intent
         │                              ├── FalkorDB (design topology)
         │                              └── Redis / BullMQ ───> Evaluation worker
         │
         └──── LiveKit room <──────────────> Voice worker
                                             ├── Silero VAD
                                             ├── Deepgram STT / TTS
                                             └── Backend question orchestration
```

**Stack:** Bun · TypeScript · Next.js / React · Hono · PostgreSQL / Prisma · Redis / BullMQ · LiveKit · Deepgram · Silero · FalkorDB · Docker · GitHub Actions.

## Quick start

**Requirements:** Bun **1.4.2**, Node.js **24+**, PostgreSQL, a Redis instance for BullMQ, and valid credentials for LiveKit, Deepgram and an OpenAI-compatible model provider. System Design mode also needs FalkorDB (on a different port/instance from BullMQ Redis).

```bash
git clone https://github.com/Manav2209/RepoRound.git
cd RepoRound
bun install

cp apps/backend/.env.example apps/backend/.env
cp apps/voice-agent/.env.example apps/voice-agent/.env
cp apps/evaluation-worker/.env.example apps/evaluation-worker/.env
cp packages/db/.env.example packages/db/.env
```

Fill in the sample environment files. The backend, evaluation worker, and Prisma CLI need the intended PostgreSQL database URL; the backend and voice worker must share `INTERNAL_API_TOKEN`. Set the public backend URL used by the browser with `NEXT_PUBLIC_BACKEND_URL` (default: `http://localhost:8080`).

```bash
bun run db:generate
bun run db:migrate:deploy
bun run dev
```

Start the background workers in **separate terminals**:

```bash
bun run agent:start
# in another terminal
bun run evaluation-worker:start
```

Open [http://localhost:3000](http://localhost:3000). By default, the API runs on port `8080`. See the existing [Setup](#setup) section for credentials, provider configuration, and manual migrations.

## Repository structure

| Location | Responsibility |
| --- | --- |
| `apps/web` | Interview UI, transcript, room, design canvas and feedback |
| `apps/backend` | Hono API, auth, repository analysis, orchestration, graph and queues |
| `apps/voice-agent` | LiveKit agent, voice pipeline, interruption and event outbox |
| `apps/evaluation-worker` | Asynchronous evaluation worker |
| `packages/db` | Prisma schema, migrations and shared database client |
| `packages/providers`, `packages/types` | Shared providers and contracts |
| `docs`, `spec` | Deployment guides and engineering specifications |

## Development checks

```bash
bun run lint
bun run check-types
bun run build
bun run --cwd apps/backend test
bun run --cwd apps/web test
```

Database-dependent integration tests are excluded from the default backend test run unless `RUN_DB_TESTS=1`. For production readiness, also exercise PostgreSQL, Redis, FalkorDB, LiveKit, the LLM provider, and the speech pipeline with real service credentials in a disposable environment.

**Continue reading:** [Architecture](#architecture) · [Response latency](#response-latency) · [State and recovery](#state-and-recovery) · [System Design graph](#system-design-graph-falkordb) · [Evaluation](#evaluation) · [Security](#access-and-security) · [Docker](#docker) · [Observability](#observability) · [Checks](#checks).

---

<!-- Insert this section at the top of the existing README.md, replacing only its current H1 and two-line introduction. Keep the detailed technical sections below. -->
