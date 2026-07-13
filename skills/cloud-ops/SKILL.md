---
name: cloud-ops
description: >
  Deployment, Docker, infrastructure, and dev environment for the StuVe Cloud platform.
  Use this skill when the user asks about Docker setup, compose files, dev environment,
  building/running the platform, CI/CD, Traefik/gateway routing, environment variables,
  or infrastructure configuration (PostgreSQL, Redis/Valkey, FreeIPA, Filegate, Geo, Gotenberg).
---

# Cloud Operations & Deployment

## Quick Start (Development)

```bash
# 1. Infrastructure (PostgreSQL, Valkey, Geo, Filegate, Gotenberg)
bun run infra

# 2. Core dev stack — 6 services, including the Assistant
bun run dev

# 3. Open the platform
open http://localhost:3000
```

To stop: `bun run dev:down` (includes extras via `--profile extra`) and `bun run infra:down`.

## Dev Stack Shape

The compose file uses **profiles** so `bun run dev` stays light. Full spin-up is opt-in.

**Stack-level commands** (whole compose project):

| Command | What it does |
|---------|--------------|
| `bun run dev` | Core set only — `gateway`, `app-gateway-ops`, `app-core`, `app-dashboard`, `app-accounts`, `app-assistant` (6 services) |
| `bun run dev:full` | Core + 17 extras via `--profile extra` (23 services total) |
| `bun run dev:down` | Tear down the dev stack |
| `bun run dev:rebuild:all` | Rebuild every image in the stack |

**Per-app commands** (operate on one or more app containers in the running stack):

| Command | What it does |
|---------|--------------|
| `bun run dev:start <app...>` | Start one or more apps; joins existing network |
| `bun run dev:stop <app...>` | Stop apps (containers stay around for fast restart) |
| `bun run dev:rebuild <app...>` | Rebuild image(s) + restart — parallel via compose |
| `bun run dev:logs <app>` | Follow one app's logs |
| `bun run dev:status` | Plain-text inventory: state, uptime, health, image age |
| `bun run dev:status <app>` | Detail block + last 20 log lines for one app |
| `bun run dev:help` | Catalog of all dev commands + the list of valid `<app>` short-names |

`<app>` accepts either the short name (`notebooks`) or the full service name (`app-notebooks`). The `gateway` service is also addressable by these commands (e.g. `bun run dev:rebuild gateway` after a gateway code change). Run `bun run dev:help` for the full list of valid names.

The `dev:status` output is plain text by design — humans get a readable table, LLM agents capturing the output get stable, scannable section headers (`State`, `Uptime`, `Health`, `Image age`) and a closed state enum (`running` / `stopped` / `never built`). Run `bun run dev:help` first for orientation; `dev:status` + `dev:status <app>` cover most "what's the dev stack doing right now" questions in two calls.

Why the split: the core set gives you login + dashboard + admin panel + log viewer + settings UI + the general-purpose Assistant; extras (`notebooks`, `files`, `spaces`, `weather`, …) are spun up only when a specific app is under development.

## Container Architecture

```
┌─────────────────────────────────────────────────┐
│                 docker compose                  │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ gateway  │  │app-gw-ops│  │app-files │ ...   │  ← router + HTTP app containers
│  │ :3000    │  │ :3000    │  │ :3000    │       │
│  └────┬─────┘  └──────────┘  └──────────┘      │
│       │ proxy                                   │
│       └────────────────┐                        │
│  ┌──────────┐  ┌───────┴──┐  ┌──────────┐      │
│  │ postgres │  │  valkey  │  │ filegate │      │  ← infrastructure (compose.yml)
│  │ :5432    │  │  :6379   │  │ :4000    │      │
│  └──────────┘  └──────────┘  └──────────┘      │
└─────────────────────────────────────────────────┘
```

## Network & Discovery

Both compose files share the same **Docker Compose project name** (= folder name `cloud`), which means they share the default network. That's the mechanism that lets an ad-hoc `dev:start <name>` container reach `ipa_postgres`, `ipa_valkey`, and `gateway` without any explicit network config. Don't override the project name with `-p` unless you're running parallel stacks.

Every app registers itself in Redis via `createHeartbeat` (60s interval, 2min TTL), carrying id, nav metadata, and `baseUrl` (e.g. `http://app-files:3000`). The gateway watches the registry and rebuilds its prefix-trie route table on change — usually within ≤5s of a new container appearing.

Gateway router source: [`packages/gateway/src/index.ts`](../../packages/gateway/src/index.ts).
Gateway Ops app source: [`packages/gateway-ops/src/index.ts`](../../packages/gateway-ops/src/index.ts).

## Infrastructure Services (compose.yml)

Started with `bun run infra`:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `postgres` | `postgres:15-alpine` | 5432 | Primary database (container: `ipa_postgres`, max 300 connections) |
| `valkey` | `valkey/valkey:8-alpine` | 6379 | Sessions, service registry, pub/sub (container: `ipa_valkey`) |
| `geo` | `ghcr.io/valentinkolb/geo` | 8081 | Geolocation service |
| `filegate` | `ghcr.io/valentinkolb/filegate` | 4000 | File proxy with token auth |
| `gotenberg` | `gotenberg/gotenberg:8` | 3001 | PDF rendering service |

**Persistent volumes:**
- `ipa_postgres_data` — PostgreSQL data
- `ipa_valkey_data` — Valkey/Redis data
- `filegate_homes`, `filegate_groups` — File storage

## App Containers (compose.dev.yml)

Every app container:

- Uses `Dockerfile.dev` (single-stage, `oven/bun:1` base)
- Mounts source for hot reload via `--watch`
- Runs the CSS preload: `--preload=/app/packages/cloud/scripts/preload.ts`
- Shares env via YAML anchors (`x-env`, `x-app`)

**Core set (6, no profile — started by `bun run dev`):** `gateway`, `app-gateway-ops`, `app-core`, `app-dashboard`, `app-accounts`, `app-assistant`.

**Extras (17, `profiles: [extra]` — `bun run dev:full` or ad-hoc via `dev:start`):** `app-notebooks`, `app-contacts`, `app-faq`, `app-grids`, `app-files`, `app-ipa-hosts`, `app-mail`, `app-oauth`, `app-proxy-auth`, `app-quotes`, `app-pulse`, `app-spaces`, `app-tools`, `app-ui-lab`, `app-venue`, `app-weather`, `app-api-docs`.

`app-pulse` is available in local development but is not release-ready yet. Keep it out of production compose files and docker release tags until it is explicitly promoted.

`gateway` is router-only: it reads the Redis app registry, builds a local prefix trie, proxies HTTP/WS traffic, exposes minimal `/health`, and publishes telemetry/snapshot data. `app-core` owns platform routes such as `/auth`, `/me`, `/admin/settings`, `/impressum`, `/legal/privacy`, and `/legal/terms`. `app-gateway-ops` is a normal Cloud app that owns `/admin/gateway`, `/admin/observability/*`, `/api/gateway`, `/api/logging`, `/api/notifications`, dashboard widgets, telemetry rollups, health webhooks, and registry observability. Gateway Ops keeps `/api/gateway/settings/legacy` only as a compatibility shim; the platform settings UI and cleanup live in Core.

### Volume Mounts (Dev)

```yaml
volumes:
  - ./packages/cloud/src:/app/packages/cloud/src       # shared core library
  - ./packages/{appId}/src:/app/packages/{appId}/src   # app source
  - ./styles.css:/app/styles.css                        # global styles entry
```

Changes to source files trigger automatic restart via Bun's `--watch`.

## Adding a New App Container

1. Add a service block in `compose.dev.yml` (extras go under `profiles: [extra]`):

```yaml
app-my-app:
  <<: *app
  container_name: app-my-app
  environment: { <<: *env, APP_ID: my-app }
  profiles: [extra]           # omit for core-set apps
  volumes:
    - ./packages/cloud/src:/app/packages/cloud/src
    - ./packages/my-app/src:/app/packages/my-app/src
    - ./styles.css:/app/styles.css
  command: bun run --preload=/app/packages/cloud/scripts/preload.ts --watch packages/my-app/src/index.ts
```

2. Add a `COPY packages/my-app/package.json packages/my-app/` line in `Dockerfile.dev` so the install layer caches the new workspace.
3. Start it standalone during development: `bun run dev:start my-app`. The app self-registers in Redis via `createHeartbeat()` on startup; the gateway picks it up within ~5 s without any central registration step. After code changes that affect the build (Dockerfile, dependencies), use `bun run dev:rebuild my-app` to rebuild + restart in one step.

For non-HTTP workers, add a standalone service name without the `app-` prefix for platform infrastructure or with a clear app prefix for app-owned workers. Workers usually should not set `profiles: [extra]` when they support the core stack. Prefer a normal app lifecycle when the same package also owns HTTP admin/API routes.

## Environment Variables

> Full reference → `references/env-reference.md`

The Docker development path does not require a local `.env`: `compose.dev.yml` supplies the values below plus `ADMIN_LOGIN_TOKEN=dev-admin`. Use `.env.example` only when running processes directly on the host or building a custom local setup. Production deployments use `.env.prod.example`.

### Required

```env
DATABASE_URL=postgresql://ipa:ipa@ipa_postgres:5432/ipa
REDIS_URL=redis://ipa_valkey:6379
APP_SECRET=dev-secret-change-me-in-production    # encrypts settings at rest
```

`APP_URL` defaults to `localhost:3000` if not set.

### FreeIPA (optional for local dev)

FreeIPA settings are primarily managed via the **runtime settings system** (DB-backed, editable in admin UI), not env vars. Environment variables provide initial bootstrap values only:

```env
FREEIPA_URL=freeipa.example.com          # default: freeipa.ipa.example.com
FREEIPA_SVC_USER=svc-cloud               # default: svc-cloud
FREEIPA_SVC_PASSWORD=change-me
GROUPS_ADMIN=admins                      # default: admins
GROUPS_BASE_SYNC=users                   # default: users
GROUPS_BASE_IPA_REALM=users              # default: users
GROUPS_EXCLUDED=editors,trust admins,admins
```

**Note:** These env vars are legacy bootstrap values. The authoritative configuration lives in the runtime settings system (DB-backed, editable in admin UI under `freeipa.*` keys). The env vars provide initial seed values on first startup and act as fallbacks if no DB value exists.

### Development Shortcuts

```env
ADMIN_LOGIN_TOKEN=dev-admin  # Emergency local admin login token for /auth/login?method=admin
```

Note: `skipSetup` (skip migrations) is an `app.start()` option, not an environment variable. There is no `DISABLE_APPS` env var implemented.

## Build Process

### CSS/Asset Building

Two paths, same Tailwind oxide scanner config:

- **Dev** — `packages/cloud/scripts/preload.ts` runs at process start, builds CSS into `<workspace>/public/`. Bun-plugin-tailwind scans the whole workspace.
- **Prod (docker)** — `packages/cloud/scripts/build.ts` runs at image-build time, emits everything into `dist/`. Generic over `APP_ID`. Apps that need extra build-time artefacts ship `packages/<id>/scripts/build-extras.ts` (only `core` does — global.css, logo.svg, katex.css served at `/public/<plain-name>`). The post-build pass walks `packages/cloud + packages/<APP_ID>` for `*.{island,client}.tsx` and removes any island chunks the SSR plugin emitted from other apps.

Each app's app.css ships at `/public/<id>/app.css`; shared assets at `/public/<plain-name>` are served from `core`.

### TypeScript Checking

```bash
bun run typecheck    # Runs all checks in sequence:
# 1. check:skills              — validate skill files
# 2. check:boundaries          — enforce package boundaries
# 3. check:cycles              — detect circular dependencies
# 4. check:service-api-contracts — validate service/API contracts
# 5. check:biome               — format + lint (Biome)
# 6. per-package typecheck      — TypeScript compilation check
```

### Linting

```bash
bun run lint         # Check only
bun run lint:fix     # Auto-fix
bun run format       # Format only
```

## CI/CD

Two workflows, separate tag namespaces so they don't collide.

### `.github/workflows/docker.yml` — per-app docker images

One single parametrised `Dockerfile` (3 stages: deps → build → runtime, `oven/bun:1-alpine`, `--build-arg APP_ID=<id>`). Multi-arch (linux/amd64 + linux/arm64). The workflow builds the configured image allowlist: `gateway`, `core`, plus `app-<id>` images for release-ready built-in apps such as `app-gateway-ops`, `app-api-docs`, and `app-venue`. `ui-lab` is dev-only and `pulse` is not release-ready yet, so both are intentionally skipped. The standalone reference app lives in [cloud-template](https://github.com/ValentinKolb/cloud-template).

| Trigger | What's built | Image tags |
|---|---|---|
| push to `main` | only images with changed source. Changes to `packages/cloud`, `Dockerfile`, `.dockerignore`, `bun.lock`, `package.json`, `styles.css` or this workflow file fan out to the full configured allowlist | `:sha-<short>`, `:main` |
| tag `cloud-<image>-v<X.Y.Z>` (e.g. `cloud-app-notebooks-v0.1.2`, `cloud-gateway-v0.1.2`) | only that one image, validated against the workflow allowlist | `:v<X.Y.Z>`, `:latest` |
| `workflow_dispatch` | the full configured allowlist on demand | `:sha-<short>` |

Pushed to `ghcr.io/valentinkolb/cloud-<image>`. **Bulk-tag-push gotcha:** GitHub Actions silently drops events past the first 3 tags in a single `git push --tags`. For multi-app releases, push tags **one at a time** with a small delay (`for tag in ...; do git push origin "$tag"; sleep 3; done`).

### `.github/workflows/npm.yml` — `@valentinkolb/cloud` to npm

OIDC trusted publisher (no `NPM_TOKEN` secret). The trusted publisher is configured once on npmjs.org for the package — Repository: `ValentinKolb/cloud`, Workflow: `npm.yml`.

| Trigger | Behaviour |
|---|---|
| tag `npm-cloud-v<X.Y.Z>` | publishes that version with `--provenance --access public` |
| `workflow_dispatch` (input: version) | manual emergency publish |

**Bump procedure:**
1. Edit `packages/cloud/package.json` → bump `version`
2. Commit + push to `main`
3. `git tag npm-cloud-vX.Y.Z && git push origin npm-cloud-vX.Y.Z`
4. CI publishes with provenance

**Why `npm pkg set` and not `npm version`:** `npm version` triggers an internal install/lockfile update that walks workspace siblings and chokes on their `workspace:*` deps. `npm pkg set version=X.Y.Z` is a pure JSON edit — same result, no resolve.

## Production Deployment

`compose.prod.yml` at the repo root pulls the configured Cloud service images from ghcr. Companion `.env.prod.example`.

Shape:
- One YAML anchor `x-shared-env` declares `DATABASE_URL`/`REDIS_URL`/`APP_SECRET`; merged into every service's `environment` via `x-app-defaults`.
- Two networks: `cloud-internal` (apps talk to each other) and `traefik` (external, only the gateway joins it with routing labels).
- `postgres`, `valkey`, `filegate` are deliberately **not** defined in the file — deployments often run them on a separate host or VM. Add the services you need alongside.
- `APP_ID`, `FILEGATE_URL`, `FILEGATE_TOKEN` are not set: container entrypoint already pins the app, and filegate config moved into runtime settings.

## Infrastructure Details

### PostgreSQL

- **Version:** 15 (Alpine)
- **Max connections:** 300 (configured in compose)
- **Schemas:** app-specific schemas plus platform-owned schemas such as `auth.*`, `logging.*`, `settings.*`, `notifications.*`, and `gateway.*`
- **Migrations:** Run on every app startup via `lifecycle.setup()` (idempotent DDL)
- **Connection:** Via Bun's native `sql` template tag (no connection pool library needed — Bun manages it)

### Valkey (Redis)

- **Version:** 8 (Alpine) — drop-in Redis replacement
- **Persistence:** `--save 30 1` (snapshot every 30s if 1+ write)
- **Usage:**
  - Session storage (`session:{userId}:{token}` with TTL)
  - App registry (`apps/{appId}` with 2min TTL + heartbeat)
  - Rate limiting state
  - Pub/sub for real-time features
- **Client:** Bun's native Redis client or `@valentinkolb/sync` primitives

### FreeIPA

External service (not containerized). Provides:
- User authentication (Kerberos/form-based)
- Group management
- Password policies

The cloud communicates via JSON-RPC at `https://{freeipa_url}/ipa/session/json`.

### Filegate

File proxy service for secure file access:
- Token-based authentication (`FILEGATE_TOKEN`)
- Path restrictions (`ALLOWED_BASE_PATHS`)
- Redis integration for state
- Volumes: `filegate_homes` (user files), `filegate_groups` (group files)
