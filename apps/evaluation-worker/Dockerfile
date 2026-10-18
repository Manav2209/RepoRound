# syntax=docker/dockerfile:1
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION} AS bun

FROM node:24-bookworm-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/evaluation-worker/package.json ./apps/evaluation-worker/
COPY apps/voice-agent/package.json ./apps/voice-agent/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/providers/package.json ./packages/providers/
COPY packages/types/package.json ./packages/types/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/ui/package.json ./packages/ui/

FROM manifests AS build
RUN bun install --frozen-lockfile --filter @repo/evaluation-worker
COPY apps/evaluation-worker ./apps/evaluation-worker
COPY apps/backend ./apps/backend
COPY packages/db ./packages/db
COPY packages/types ./packages/types
COPY packages/typescript-config ./packages/typescript-config
RUN bun run --cwd packages/db build \
    && bun run --cwd apps/evaluation-worker build

FROM manifests AS production-deps
RUN bun install --frozen-lockfile --production --filter @repo/evaluation-worker

FROM base AS runner
ENV NODE_ENV=production
COPY --from=production-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/packages/db/src /app/packages/db/src
COPY --from=build --chown=node:node /app/packages/db/generated /app/packages/db/generated
COPY --from=build --chown=node:node /app/packages/types/src /app/packages/types/src
COPY --from=build --chown=node:node /app/apps/backend/src /app/apps/backend/src
COPY --from=build --chown=node:node /app/apps/evaluation-worker/src /app/apps/evaluation-worker/src
WORKDIR /app/apps/evaluation-worker
USER node
# Healthy when the BullMQ Redis backing the evaluation queue is reachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD bun -e "const { Redis } = await import('ioredis'); const r = new Redis(process.env.BULLMQ_REDIS_URL, { maxRetriesPerRequest: null }); await r.ping(); process.exit(0);"
CMD ["bun", "run", "src/main.ts"]
