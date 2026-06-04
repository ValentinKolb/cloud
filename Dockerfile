# Per-app production image.
#
#   docker build --build-arg APP_ID=<id> -t cloud-<id> .
#
# `deps` is independent of APP_ID, so the same install layer is cached
# across all 21 apps. `build` and `runtime` are app-specific.

# ──────────────────────────────────────────────────────────────────────
# Stage 1: deps — install workspace dependencies (cache-shared).
# ──────────────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/accounts/package.json      packages/accounts/
COPY packages/api-docs/package.json      packages/api-docs/
COPY packages/cloud/package.json         packages/cloud/
COPY packages/contacts/package.json      packages/contacts/
COPY packages/core/package.json          packages/core/
COPY packages/dashboard/package.json     packages/dashboard/
COPY packages/faq/package.json           packages/faq/
COPY packages/files/package.json         packages/files/
COPY packages/grids/package.json         packages/grids/
COPY packages/gateway/package.json       packages/gateway/
COPY packages/ipa-hosts/package.json     packages/ipa-hosts/
COPY packages/logging/package.json       packages/logging/
COPY packages/notebooks/package.json     packages/notebooks/
COPY packages/notifications/package.json packages/notifications/
COPY packages/oauth/package.json         packages/oauth/
COPY packages/proxy-auth/package.json    packages/proxy-auth/
COPY packages/quotes/package.json        packages/quotes/
COPY packages/settings/package.json      packages/settings/
COPY packages/spaces/package.json        packages/spaces/
COPY packages/tools/package.json         packages/tools/
COPY packages/ui-lab/package.json        packages/ui-lab/
COPY packages/weather/package.json       packages/weather/

# --ignore-scripts: bun-plugin-tailwind declares `bun` as a peer dep, which
# pulls the npm `bun` package whose postinstall extracts a platform binary
# and fails inside the build sandbox. We don't need it (oven/bun image has
# bun) and there are no other postinstalls that matter here.
RUN bun install --frozen-lockfile --ignore-scripts

# ──────────────────────────────────────────────────────────────────────
# Stage 2: build — bundle one app into /app/dist.
# ──────────────────────────────────────────────────────────────────────
FROM deps AS build
ARG APP_ID
ENV APP_ID=${APP_ID} \
    NODE_ENV=production

COPY packages packages
COPY styles.css ./

RUN bun run packages/cloud/scripts/build.ts

# ──────────────────────────────────────────────────────────────────────
# Stage 3: runtime — only the bundled output + bun runtime.
# ──────────────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./

EXPOSE 3000
CMD ["bun", "server.js"]
