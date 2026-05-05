FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/api-server/package.json packages/api-server/
COPY packages/dashboard/package.json packages/dashboard/
COPY lib/api-client-react/package.json lib/api-client-react/
RUN pnpm install --frozen-lockfile --shamefully-hoist

# ── Build API ─────────────────────────────────────────────────────────────────
FROM deps AS build-api
COPY packages/api-server/ packages/api-server/
COPY lib/ lib/
RUN cd packages/api-server && pnpm run build

# ── Build Dashboard ───────────────────────────────────────────────────────────
FROM deps AS build-dashboard
COPY packages/dashboard/ packages/dashboard/
COPY lib/ lib/
RUN cd packages/dashboard && pnpm run build

# ── Production ────────────────────────────────────────────────────────────────
FROM node:22-slim AS production

# gosu needed to fix named-volume ownership at startup then drop to appuser
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system appgroup \
    && adduser --system --home /home/appuser --ingroup appgroup appuser \
    && chown appuser:appgroup /home/appuser

# claude CLI comes from @anthropic-ai/claude-code in node_modules/.bin
ENV NODE_ENV=production \
    PORT=3000 \
    HOME=/home/appuser \
    PATH="/app/node_modules/.bin:/usr/local/bin:/usr/bin:/bin"

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api-server/node_modules ./packages/api-server/node_modules
COPY --from=build-api /app/packages/api-server/dist ./packages/api-server/dist
COPY --from=build-api /app/packages/api-server/package.json ./packages/api-server/
COPY --from=build-dashboard /app/packages/dashboard/dist/public ./packages/dashboard/dist/public

RUN mkdir -p /app/packages/api-server/data \
    && chown -R appuser:appgroup /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/packages/api-server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
