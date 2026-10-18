# syntax=docker/dockerfile:1
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION} AS bun

# LiveKit RTC and ONNX Runtime need glibc; Alpine is not supported.
FROM node:24-bookworm-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/voice-agent/package.json ./apps/voice-agent/
COPY apps/web/package.json ./apps/web/
COPY apps/evaluation-worker/package.json ./apps/evaluation-worker/
COPY packages/db/package.json ./packages/db/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/providers/package.json ./packages/providers/
COPY packages/types/package.json ./packages/types/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/ui/package.json ./packages/ui/

FROM manifests AS build
RUN bun install --frozen-lockfile --filter @repo/voice-agent
COPY apps/voice-agent ./apps/voice-agent
COPY packages/providers ./packages/providers
COPY packages/types ./packages/types
COPY packages/typescript-config ./packages/typescript-config
RUN bun run --cwd apps/voice-agent build

FROM manifests AS production-deps
RUN bun install --frozen-lockfile --production --filter @repo/voice-agent
# Silero's model is bundled with the plugin. Verify its native CPU runtime now.
RUN bun -e "import { VAD } from '@livekit/agents-plugin-silero'; await VAD.load(); console.log('Silero VAD loaded')"

FROM base AS runner
ENV NODE_ENV=production VOICE_OUTBOX_DIR=/app/data/voice-outbox
COPY --from=production-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/voice-agent/src /app/apps/voice-agent/src
COPY --from=build --chown=node:node /app/packages/providers/src /app/packages/providers/src
COPY --from=build --chown=node:node /app/packages/types/src /app/packages/types/src
RUN mkdir -p /app/data/voice-outbox && chown node:node /app/data/voice-outbox
WORKDIR /app/apps/voice-agent
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD bun -e "const r = await fetch('http://127.0.0.1:8081/'); process.exit(r.ok ? 0 : 1)"
CMD ["bun", "run", "src/main.ts", "start"]
