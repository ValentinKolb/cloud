# Running, configuring, and deploying

Both flows — built-in apps in the monorepo, and standalone apps against the npm package.

## Monorepo: the dev loop

```bash
bun run infra      # postgres, valkey, geo, filegate, gotenberg
bun run dev        # the 6-service core set
open http://localhost:3000
```

Dev admin login: `/auth/login?method=admin`, token `dev-admin`.

The Docker dev path needs **no `.env`** — `compose.dev.yml` supplies the database, Redis, app-secret, and admin-token values. `.env.example` is only for running processes directly on the host.

| Command | What it does |
|---|---|
| `bun run dev` | Core set — `gateway`, `app-gateway-ops`, `app-core`, `app-dashboard`, `app-accounts`, `app-assistant`. Runs in the **foreground** |
| `bun run dev:full` | Core plus the 17 extras (23 services). Also foreground |
| `bun run dev:start <app…>` | Start apps in the running stack. Does **not** rebuild |
| `bun run dev:stop <app…>` | Stop; the container is preserved for a fast restart |
| `bun run dev:rebuild <app…>` | Rebuild the image and restart, parallel across apps |
| `bun run dev:logs <app>` | Follow one app's logs — exactly one argument |
| `bun run dev:status` | Plain-text inventory: state, uptime, health, image age |
| `bun run dev:status <app>` | Detail block plus the last 20 log lines |
| `bun run dev:help` | Every dev command and the valid app names |
| `bun run dev:down` | Tear the stack down, including extras |

`<app>` takes either the short name or the full service name. The 23 addressable names:

```
gateway  gateway-ops  core  dashboard  accounts  assistant
api-docs  contacts  faq  files  grids  ipa-hosts  mail
notebooks  oauth  proxy-auth  pulse  quotes  spaces
tools  ui-lab  venue  weather
```

`gateway` is the only one without an `app-` prefix. `dev:status` output is plain text on purpose, with a closed state enum — `running`, `stopped`, `never built` — and colours suppressed when stdout is not a TTY, so piping it is safe.

Why the split: the core set gives login, dashboard, admin, logs, settings, and the assistant. Extras spin up only when you are working on them.

> **The compose project name is the directory name.** Neither compose file declares `name:` or `networks:`, so both rely on the implicit project `cloud` and its default network. That is the entire mechanism by which app containers resolve `ipa_postgres`, `ipa_valkey`, and `filegate`, and by which an ad-hoc `dev:start` container joins the stack. **Cloning the repo into a differently named directory silently breaks cross-file networking.** Do not pass `-p` unless you are deliberately running parallel stacks.

Only one port is published: `3000` on the gateway. Everything else talks over the compose network.

### Infrastructure

| Service | Image | Container | Port |
|---|---|---|---|
| postgres | `postgres:15-alpine` | `ipa_postgres` | 5432 |
| valkey | `valkey/valkey:8-alpine` | `ipa_valkey` | 6379 |
| geo | `ghcr.io/valentinkolb/geo` | `geo` | 8081→4000 |
| filegate | `ghcr.io/valentinkolb/filegate` | `filegate` | 4000 |
| gotenberg | `gotenberg/gotenberg:8` | `gotenberg` | 3001→3000 |

Postgres runs with `max_connections=300`; Valkey with `--save 30 1`. Volumes: `ipa_postgres_data`, `ipa_valkey_data`, `filegate_homes`, `filegate_groups`.

### Adding a container

```yaml
app-my-app:
  <<: *app
  container_name: app-my-app
  environment: { <<: *env, APP_ID: my-app }
  profiles: [extra]           # omit for core-set apps
  volumes:
    - ./packages/cloud/src:/app/packages/cloud/src
    - ./packages/cloud/scripts:/app/packages/cloud/scripts
    - ./packages/my-app/src:/app/packages/my-app/src
    - ./styles.css:/app/styles.css
  command: bun run --preload=/app/packages/cloud/scripts/preload.ts --watch packages/my-app/src/index.ts
```

Then add `COPY packages/my-app/package.json packages/my-app/` to `Dockerfile.dev` so the install layer caches the new workspace, run `bun install`, and `bun run dev:start my-app`. The app self-registers; the gateway picks it up within seconds.

For a non-HTTP worker, give it its own compose service and do **not** register it in the app registry.

## Standalone: the dev loop

The starter is [cloud-template](https://github.com/ValentinKolb/cloud-template):

```bash
git clone https://github.com/ValentinKolb/cloud-template my-cloud
cd my-cloud
cp .env.example .env
docker compose up -d
```

Its compose pulls the prebuilt platform images from ghcr and builds only your app locally. Your app depends on `@valentinkolb/cloud` from npm — no monorepo, no workspace, no platform source in your repo.

**What your app needs from the platform at runtime.** The HTML template hard-codes `/public/fonts.css`, `/public/tabler-icons.css`, `/public/tabler-icons.woff2`, `/public/global.css`, and `/branding/favicon` — all served by the **`cloud-core`** container. Your app serves only `/public/<your-id>/*`. So a standalone app needs, in the same network: `cloud-core`, `cloud-gateway`, Postgres, and Redis. It cannot render correctly without core.

The dev-time preloader registers the SSR plugin and builds `app.css` in watch mode. It takes the same `APP_DIR` contract as the production build:

```bash
APP_ID=my-app APP_DIR=. bun run --preload=node_modules/@valentinkolb/cloud/scripts/preload.ts src/index.ts
```

`global.css`, the fonts, the icon webfont, and the branding logo are **not** built here — they come from the prebuilt core container.

## Build

**Production, both shapes.** `packages/cloud/scripts/build.ts` is generic over `APP_ID` and resolves the framework directory correctly whether it runs from `packages/cloud/scripts/` or from `node_modules/@valentinkolb/cloud/scripts/`.

```bash
# monorepo — APP_DIR defaults to packages/<APP_ID>
APP_ID=my-app bun run packages/cloud/scripts/build.ts

# standalone — APP_DIR is the directory that CONTAINS src/
APP_ID=my-app APP_DIR=. bun run node_modules/@valentinkolb/cloud/scripts/build.ts
```

It emits into `<cwd>/dist`: `server.js`, `_ssr/<island>.js`, `public/<id>/app.css`, and anything from `<appDir>/public/`. It also prunes island chunks belonging to other apps, runs `<appDir>/scripts/build-extras.ts` when present, and pre-compresses static output as `.br` and `.gz`. Run the result with `bun server.js` — the bundle is self-contained, with no `node_modules` in the final image.

Two packages ship `build-extras.ts`: `core` (the shared `global.css`, logo, katex, IBM Plex fonts, Tabler icon webfont) and `notebooks` (its script-intelligence worker).

**Development (monorepo).** `preload.ts` runs at process start, registers the SSR plugin, and builds `public/<id>/app.css` with a debounced file watcher. It builds the shared `global.css` only for `APP_ID=core`.

**Docker.** `Dockerfile` has three stages — `deps` (per-package `package.json` COPY layer so the install cache is app-independent), `build` (`--build-arg APP_ID`), and `runtime` (`oven/bun:1-alpine`, `CMD ["bun","server.js"]`). `Dockerfile.dev` is single-stage on `oven/bun:1` and takes its command from compose.

## Checks

```bash
bun run typecheck     # the full gate
bun run lint          # check only
bun run lint:fix
bun run format
```

`typecheck` runs eight steps in sequence: `check:skills`, `check:boundaries`, `check:cycles`, `check:service-api-contracts`, `check:ui-lab`, `check:css`, `check:biome`, then per-package `tsc`.

Of these, `check:boundaries` is the one encoding rules an app author should care about. It enforces four:

- imports resolve against the real `@valentinkolb/cloud` exports map, not just a first path segment — so an import that works in the monorepo cannot still break for an npm consumer;
- no reaching into framework source, and no cross-app imports;
- a CLI command that branches on `output === "json"` must also handle `"jsonl"`;
- no app reads `c.get("user")`.

The rest is framework-maintainer hygiene and hardcodes monorepo paths; a standalone app runs its own `tsc` and tests instead.

> **There is no CI on pull requests.** No workflow has a `pull_request` trigger, so `typecheck` and the test suites do not gate merges. Run them locally before you push.

## CI/CD

Three workflows, three separate tag namespaces.

**`docker.yml`** — per-app images to `ghcr.io/valentinkolb/`. Naming: `gateway` and `core` become `cloud-<app>`; everything else becomes `cloud-app-<app>`. Multi-arch amd64 + arm64.

| Trigger | Builds | Tags |
|---|---|---|
| push to `main` | only images whose source changed. A change to `packages/cloud/`, `Dockerfile`, `.dockerignore`, `bun.lock`, `package.json`, `styles.css`, or the workflow itself fans out to the whole allowlist | `sha-<short>`, `main` |
| tag `cloud-<image>-v<X.Y.Z>` | that one image, validated against the allowlist (exits 1 on a miss) | `v<X.Y.Z>`, `latest` |
| `workflow_dispatch` | the whole allowlist | `sha-<short>` |

The allowlist in the workflow is the single source of truth for what ships. Everything in the workspace is on it except `ui-lab`, which is dev-only, and `pulse`, which is not release-ready.

> **Bulk tag push gotcha:** GitHub silently drops events past the first three tags in one `git push --tags`. Push release tags one at a time with a small delay.

**`npm.yml`** — publishes `@valentinkolb/cloud` on tag `npm-cloud-v<X.Y.Z>` via an OIDC trusted publisher, with `--provenance --access public`. Bump with `npm pkg set version=X.Y.Z`, never `npm version` — the latter triggers an install that walks workspace siblings and chokes on their `workspace:*` deps.

**`cli.yml`** — on tag `cli-v<X.Y.Z>`, builds the `cld` binary for four targets, signs artifacts with keyless cosign, and ships `skills/cloud-cli` as a release asset. Its verify job is the only place any test currently runs in CI. It refuses to overwrite assets of an already-published release.

## Production

`compose.prod.yml` pulls the released images. Shape:

- One `x-shared-env` anchor supplies `DATABASE_URL`, `REDIS_URL`, `APP_SECRET`, and `APP_URL` to every service.
- Two networks: `cloud-internal` for app-to-app traffic, and an external `traefik` network that only the gateway joins, carrying the routing labels.
- `postgres`, `valkey`, and `filegate` are **deliberately absent** — deployments often run them on a separate host. Add what you need; apps reference `postgres:5432` and `valkey:6379`.
- `APP_ID` is not set per service: the image entrypoint already pins the app.

Companion template: `.env.prod.example`. Its five keys (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `APP_SECRET`, `CLOUD_HOST`) are compose interpolation only — no app code reads them directly.

## Environment variables

Very few, because almost all configuration is runtime settings instead.

`packages/cloud/src/config/env.ts` exports exactly four: `APP_SECRET`, `PORT`, `IS_DEVELOPMENT` (from `NODE_ENV`), and `ADMIN_LOGIN_TOKEN`. It validates nothing and never throws.

| Variable | Where it is consumed |
|---|---|
| `DATABASE_URL` | **Implicit** — Bun's global `sql` reads it. No app-level read |
| `REDIS_URL` | **Implicit** — Bun's global `redis` reads it. Unset means `localhost:6379`, which fails silently inside Docker |
| `APP_SECRET` | Encrypts settings at rest. **Every app must share the same value** |
| `APP_ID` | Set per container; selects which app the image runs |
| `ADMIN_LOGIN_TOKEN` | Enables `/auth/login?method=admin`. Development only |
| `APP_URL`, `FREEIPA_*`, `GROUPS_*`, `FILEGATE_*`, `MAIL_OAUTH_*` | **Bootstrap fallbacks only** for the corresponding runtime settings |

> `APP_SECRET` has no default. `app.start()` refuses to boot without it, so a misconfigured container fails immediately and says so, rather than starting and dying later on its first settings read.

## Runtime settings

Most configuration is DB-backed, encrypted at rest, and editable in the admin UI under `/admin/settings` — not environment variables. Keys are dotted, and the group shown in the UI is derived from the first segment.

Declaration is `defineApp({ settings })` with a typed map. Kinds: `string`, `text`, `email`, `url`, `secret`, `image`, `cron`, `timezone`, `template`, `boolean`, `number`, `enum`, `string_list`, `number_list`. Many core keys declare an `envFallback`.

Read path, in order: Redis cache (`settings:<key>`, 300 s TTL) → Postgres `settings.entries`, decrypted and validated → `envFallback` → code default. Writes validate, encrypt, upsert, then **delete** the shared Redis key.

That delete is what gives cross-container coherence without polling or pub/sub: a write in one container invalidates the cache for all of them, and the next container to read misses, goes to Postgres, sees the new value, and repopulates. **A changed setting is visible everywhere on the next read.** The 300 s TTL is not the propagation delay — it is the recovery bound for the abnormal cases: a row changed directly in the database, or a failed invalidation.

Within a single request the picture is deliberately different: `c.get("settings")` is a snapshot taken once and frozen. It will not change mid-request, and it is not supposed to.

**Do not rely on a written-down table of defaults.** The registry is large and moves; read the current values from the admin UI, or from the declarations. Platform settings are declared once in `packages/cloud/src/services/settings/core-settings.ts` — in the framework, because every container has to register them, not just the one that renders their admin UI. App-scoped settings live in that app's `defineApp({ settings })`.

The keys an app author touches most: `app.url` (email links, OAuth redirects, WebAuthn RP origin — must be HTTPS outside localhost), `app.name`, `app.timezone` (the wall-clock zone for jobs and schedulers), `app.home_path` (where `/` redirects), `user.session.expiry_hours`, `logs.retention_days`, and `security.rate_limit_per_second`.

## FreeIPA operations

FreeIPA is optional — the platform runs on local accounts and magic-link login alone. This section is for operators enabling it.

Configuration is runtime settings under `freeipa.*`, with env vars as first-boot bootstrap only. The master switch is `freeipa.enable`, which bootstraps to `true` when `FREEIPA_URL`, `FREEIPA_SVC_USER`, and `FREEIPA_SVC_PASSWORD` are all present.

Cloud talks JSON-RPC to `https://<freeipa_url>/ipa/session/json`. Trust a private CA with `freeipa.ca_cert` (PEM); `freeipa.allow_insecure` skips TLS validation entirely and is local-development only — it is ignored when `ca_cert` is set.

### Service account permissions

Every FreeIPA-backed directory mutation runs as the configured service account, after Cloud's own authorization and audit checks. That account needs FreeIPA-side permission for exactly the RPCs Cloud issues:

| Area | RPCs |
|---|---|
| Users | `user_add`, `user_mod`, `user_del`, `user_find`, `user_show` |
| Groups | `group_add`, `group_mod`, `group_del`, `group_find` |
| Group membership | `group_add_member`, `group_remove_member` |
| Member managers | `group_add_member_manager`, `group_remove_member_manager` |
| Hosts | `host_mod`, `host_del`, `host_find` |
| Host groups | `hostgroup_add`, `hostgroup_mod`, `hostgroup_del`, `hostgroup_find`, `hostgroup_add_member`, `hostgroup_remove_member` |
| Connectivity | `ping` |

Note there is no `host_add` — Cloud never creates hosts. Grant member-manager writes explicitly; ordinary "modify group membership" permission does not necessarily cover `group_add_member_manager`.

The FreeIPA privilege and role names needed to grant these are deployment-specific and **cannot be validated from this repository**. Verify them against your own FreeIPA instance; nothing in CI will catch drift here.

### Group configuration

| Setting | Meaning |
|---|---|
| `freeipa.groups.base_sync` | Groups whose members Cloud syncs at all |
| `freeipa.groups.base_ipa_realm` | Groups whose members become full `ipa/user` rather than `ipa/guest` |
| `freeipa.groups.admin` | Groups granting the `admin` role |
| `freeipa.groups.excluded` | Hidden from the display graph **only** — still counted for scope, profile, and admin, and traversal through them still works |

> `base_sync` and `base_ipa_realm` are **required** and have no default. There is no safe guess: one decides who gets a Cloud account at all, the other who is a full user rather than a guest, and both depend on how the directory is organised. Leaving either empty makes the FreeIPA config incomplete, so sync and lifecycle refuse to run and name the missing key — rather than syncing nobody and silently demoting every account to guest, which is what an empty list would otherwise mean.

`groups.admin` defaults to `["admins"]` and `groups.excluded` to the standard FreeIPA system groups; those are genuine directory-wide defaults.

The auth-model consequences of these settings — profile derivation, admin resolution, the effective-group projection, and the fail-closed self-service extension — are in `auth.md`.
