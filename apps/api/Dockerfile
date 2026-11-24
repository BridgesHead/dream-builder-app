# syntax=docker/dockerfile:1.7
# Dream Builder API image. One image, two programs (infra/README.md):
#   API:    the default command
#   worker: command ./node_modules/.bin/tsx src/worker.ts
#
# Build from the REPO ROOT (the monorepo is the build context):
#   docker build -f apps/api/Dockerfile -t dream-builder-api .
# CI builds it for linux/arm64 (the AWS Graviton servers).

ARG NODE_VERSION=24

# ---- 1. Install the API's dependencies -------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
# Compilers in case a native package (argon2) has no ready-made binary for this platform
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Download every package in the lock file first; this layer only changes when the lock file does
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# Then the code (see /.dockerignore for what's left out), and install offline just what
# @dream-builder/api needs. Dev dependencies are kept on purpose: the API runs through tsx.
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@dream-builder/api..." \
 && mkdir -p apps/api/data/storage

# ---- 2. Runtime image, without the compilers ------------------------------------------
FROM node:${NODE_VERSION}-slim
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /repo/apps/api
COPY --from=build --chown=node:node /repo /repo
USER node
EXPOSE 3000

# GET /api/v1/health answers 200 only when MongoDB is connected
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tsx directly (not "pnpm start") so stop signals reach the app and it shuts down cleanly
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
