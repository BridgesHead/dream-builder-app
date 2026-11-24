# syntax=docker/dockerfile:1.7
# Dream Builder frontend image: the built site (apps/web) served by a small Caddy on port 8080.
# On the servers the front Caddy (infra/server/Caddyfile) sends /api/* to the API and everything
# else here, so the browser sees ONE origin: no CORS, and the login cookie stays first-party.
#
# Build from the REPO ROOT (the monorepo is the build context):
#   docker build -f apps/web/Dockerfile -t dream-builder-web .
# CI builds it for linux/arm64 (the AWS Graviton servers). The build stage runs on the CI
# machine's own platform and only the finished files go into the arm64 image, so the site is
# built at full speed, without emulation.

ARG NODE_VERSION=24

# ---- 1. Build the site --------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Download every package in the lock file first; this layer only changes when the lock file does
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# Then the code (see Dockerfile.dockerignore next to this file) and the build
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@dream-builder/web..." \
 && pnpm --filter @dream-builder/web build

# ---- 2. Serve it ---------------------------------------------------------------------------
FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 8080
