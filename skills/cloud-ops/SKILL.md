---
name: cloud-ops
description: >
  Deployment, Docker, infrastructure, and dev environment for the StuVe Cloud platform.
  Use this skill when the user asks about Docker setup, compose files, dev environment,
  building/running the platform, CI/CD, Traefik/gateway routing, environment variables,
  or infrastructure configuration (PostgreSQL, Redis/Valkey, FreeIPA, Filegate).
---

# Cloud Operations & Deployment

## Quick Start (Development)

```bash
# 1. Infrastructure (PostgreSQL, Valkey, Geo, Filegate)
bun run infra

# 2. Core dev stack — 6 containers, enough to log in and manage accounts
bun run dev

# 3. Open the platform
open http://localhost:3000
```

To stop: `bun run dev:down` (includes extras via `--profile extra`) and `bun run infra:down`.

## Dev Stack Shape

The compose file uses **profiles** so `bun run dev` stays light. Full 18-app spin-up is opt-in.

| Command | What it does |
|---------|--------------|
| `bun run dev` | Core set only — `gateway`, `app-core`, `app-accounts`, `app-logging`, `app-settings`, `app-notifications` (6 containers) |
| `bun run dev:full` | Core + all extras via `--profile extra` (19 containers) |
| `bun run dev:app <name>` | Start one extra app into the running stack — joins the existing network automatically |
| `bun run dev:app stop <name>` / `logs <name>` | Stop / tail that app |
| `bun run dev:down` | Tear down the dev stack |

Why the split: the core set gives you login + admin panel + log viewer + settings UI; extras (`notebooks`, `files`, `spaces`, `weather`, …) are spun up only when a specific app is under development. Running all 18 simultaneously is the reason a small laptop stalls.

## Container Architecture

```
┌─────────────────────────────────────────────────┐
│                 docker compose                  │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ gateway  │  │ app-core │  │app-files │ ...   │  ← app containers (compose.dev.yml)
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

Both compose files share the same **Docker Compose project name** (= folder name `cloud`), which means they share the default network. That's the mechanism that lets an ad-hoc `dev:app <name>` container reach `ipa_postgres`, `ipa_valkey`, and `gateway` without any explicit network config. Don't override the project name with `-p` unless you're running parallel stacks.

Every app registers itself in Redis via `createHeartbeat` (60s interval, 2min TTL), carrying id, nav metadata, and `baseUrl` (e.g. `http://app-files:3000`). The gateway watches the registry and rebuilds its prefix-trie route table on change — usually within ≤5s of a new container appearing.

Gateway source: [`packages/apps/src/gateway/index.ts`](../../packages/apps/src/gateway/index.ts).

## Infrastructure Services (compose.yml)

Started with `bun run infra`:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `ipa_postgres` | `postgres:15-alpine` | 5432 | Primary database (max 300 connections) |
| `ipa_valkey` | `valkey/valkey:8-alpine` | 6379 | Sessions, service registry, pub/sub |
| `geo` | `ghcr.io/valentinkolb/geo` | 8081 | Geolocation service |
| `filegate` | `ghcr.io/valentinkolb/filegate` | 4000 | File proxy with token auth |

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

**Core set (6, no profile — started by `bun run dev`):** `gateway`, `app-core`, `app-accounts`, `app-logging`, `app-settings`, `app-notifications`.

**Extras (13, `profiles: [extra]` — `bun run dev:full` or ad-hoc via `dev:app`):** `app-notebooks`, `app-contacts`, `app-faq`, `app-files`, `app-ipa-hosts`, `app-oauth`, `app-proxy-auth`, `app-quotes`, `app-spaces`, `app-terms`, `app-tools`, `app-ui-lab`, `app-weather`.

### Volume Mounts (Dev)

```yaml
volumes:
  - ./packages/cloud/src:/app/packages/cloud/src       # shared core library
  - ./packages/apps/src/{appId}:/app/packages/apps/src/{appId}  # app source
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
    - ./packages/apps/src/my-app:/app/packages/apps/src/my-app
    - ./styles.css:/app/styles.css
  command: bun run --preload=/app/packages/cloud/scripts/preload.ts --watch packages/apps/src/my-app/index.ts
```

2. Register in `packages/apps/src/index.ts`.
3. Start it standalone during development: `bun run dev:app my-app`.

## Environment Variables

> Full reference → `references/env-reference.md`

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
GROUPS_BASE_IPA_REALM=cloud              # default: cloud
GROUPS_EXCLUDED=editors,trust admins,admins
```

**Note:** These env vars are legacy bootstrap values. The authoritative configuration lives in the runtime settings system (DB-backed, editable in admin UI under `freeipa.*` keys). The env vars provide initial seed values on first startup and act as fallbacks if no DB value exists.

### Development Shortcuts

```env
ADMIN_LOGIN_TOKEN=dev-admin  # Emergency local admin login (any username + this as password)
```

Note: `skipSetup` (skip migrations) is an `app.start()` option, not an environment variable. There is no `DISABLE_APPS` env var implemented.

## Build Process

### CSS/Asset Building

CSS is built at **runtime** via a Bun preload script (`packages/cloud/scripts/preload.ts`):

1. Registers `bun-plugin-tailwind` which scans the entire workspace for Tailwind classes
2. The `core` app builds `global.css` at `/public/global.css` (shared across all apps)
3. Each app builds its own `app.css` at `/public/{appId}/app.css`
4. Cache busting via timestamp-based version: `?v={Date.now()}`

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

**File:** `.github/workflows/docker.yml`

**Triggers:** Push to `main`, version tags (`v*`), PRs to `main`, manual dispatch.

**Pipeline:**
1. Checkout
2. Setup Docker Buildx
3. Login to `ghcr.io` (skipped on PR)
4. Generate Docker metadata (SHA tags, version tags)
5. Build and push to `ghcr.io/valentinkolb/cloud`

**Tags:**
- Branch pushes: `sha-{commit}` 
- Version tags: `v1.2.3` → `1.2.3` + `latest`
- PRs: build only (no push)

## Production Deployment

> **TBD** — Production deployment setup is planned but not yet implemented.

The CI/CD pipeline references `packages/containers/Dockerfile` for the production image, which needs to be created. Key considerations for the production Dockerfile:

- Multi-stage build (deps → build → runtime)
- Pre-built CSS assets (not runtime building)
- Minimal image size
- Health checks
- Non-root user

## Infrastructure Details

### PostgreSQL

- **Version:** 15 (Alpine)
- **Max connections:** 300 (configured in compose)
- **Schemas:** One per app domain (`auth.*`, `logging.*`, `settings.*`, `notifications.*`, plus app-specific)
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
