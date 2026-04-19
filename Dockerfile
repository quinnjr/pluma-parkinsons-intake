# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.33.0

FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate \
 && pnpm run build

FROM node:${NODE_VERSION}-slim AS runtime
ARG PNPM_VERSION
ENV NODE_ENV=production \
    PORT=4000 \
    PNPM_HOME=/home/node/.local/share/pnpm \
    PATH=/home/node/.local/share/pnpm:$PATH
WORKDIR /app

RUN corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate \
 && mkdir -p /data \
 && chown -R node:node /app /data

COPY --from=deps    --chown=node:node /app/node_modules   ./node_modules
COPY --from=build   --chown=node:node /app/dist           ./dist
COPY --from=build   --chown=node:node /app/server         ./server
COPY --from=build   --chown=node:node /app/prisma         ./prisma
COPY --from=build   --chown=node:node /app/prisma.config.ts /app/package.json ./

USER node
EXPOSE 4000

# Run migrations against the mounted volume, then boot the SSR + API server.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/pluma-parkinsons-intake/server/server.mjs"]
