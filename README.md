<p align="center">
  <img src="./packages/cloud/public/logo.svg" alt="Cloud" width="96" height="96">
</p>

<h1 align="center">Cloud</h1>

<p align="center">
  <em>Self-hosted application platform.</em>
</p>

Cloud bundles a set of apps that cover the common operational needs of an organisation — accounts, settings, observability, notifications, files, notebooks, calendars, OAuth — and is built around the custom apps you write yourself. Custom apps get the same session, UI kit, search hooks, and admin pages as the apps in the box.

## Highlights

- **Built around your own apps.** Adding an app is one config file plus a Dockerfile. The platform picks it up at runtime.
- **Per-app deployment.** Every feature is a separate Bun container, started, updated and scaled on its own.
- **Horizontal scaling.** Apps are stateless and discovered through a Redis-backed registry — `docker compose up --scale notebooks=3` and the gateway routes across all instances.
- **Bun + Hono + SolidJS + Postgres + Redis.** End-to-end TypeScript.
- **Admin surface for everything.** Per-app admin pages, settings managed in the UI, requests route-traced through the gateway.

## What ships

| Group | Apps |
|---|---|
| **Platform** | [`core`](packages/core) — auth, profile, settings, legal pages, transactional email &nbsp;•&nbsp; [`gateway`](packages/gateway) — routing and app registry |
| **Identity & access** | [`accounts`](packages/accounts) — users + groups, FreeIPA and local &nbsp;•&nbsp; [`oauth`](packages/oauth) — OAuth2 issuer &nbsp;•&nbsp; [`proxy-auth`](packages/proxy-auth) — Traefik forward-auth &nbsp;•&nbsp; [`ipa-hosts`](packages/ipa-hosts) — FreeIPA host management |
| **Operations** | [`gateway-ops`](packages/gateway-ops) — app registry, routes, logs, telemetry, webhooks, notifications |
| **Productivity** | [`assistant`](packages/assistant) — general-purpose AI chat &nbsp;•&nbsp; [`mail`](packages/mail) — collaborative email &nbsp;•&nbsp; [`notebooks`](packages/notebooks) — collaborative notes (Yjs) &nbsp;•&nbsp; [`spaces`](packages/spaces) — kanban / list / calendar with iCal &nbsp;•&nbsp; [`files`](packages/files) — shared storage &nbsp;•&nbsp; [`contacts`](packages/contacts) — directory views |
| **Content & misc** | [`faq`](packages/faq) &nbsp;•&nbsp; [`venue`](packages/venue) &nbsp;•&nbsp; [`weather`](packages/weather) &nbsp;•&nbsp; [`quotes`](packages/quotes) &nbsp;•&nbsp; [`tools`](packages/tools) |
| **Development** | [`api-docs`](packages/api-docs) — Scalar UI aggregating every running app's OpenAPI spec &nbsp;•&nbsp; [`ui-lab`](packages/ui-lab) — component showcase |

## Build your own app

The whole platform is structured around custom apps. The starter repo **[github.com/ValentinKolb/cloud-template](https://github.com/ValentinKolb/cloud-template)** has everything to run the platform plus your own app side-by-side: a single `docker compose up` pulls the prebuilt platform images from ghcr and builds your custom app locally. Your app depends on `@valentinkolb/cloud` from npm — no monorepo, no workspace, no platform code in your repo.

```bash
git clone https://github.com/ValentinKolb/cloud-template my-cloud
cd my-cloud
cp .env.example .env
docker compose up -d
```

The template ships with a working reference app (`expeditions`) you can edit, fork, or replace — it exercises every platform primitive (tenancy, permissions, admin pages, dashboard widget, transactional email, structured logging) in one small app. Its README is the full app-authoring walkthrough.

```ts
// src/config.ts in cloud-template
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "my-app",
  name: "My App",
  icon: "ti ti-rocket",
  basePath: "/app/my-app",
  baseUrl: "http://app-my-app:3000",
  nav: { href: "/app/my-app", section: "more" },
  routes: ["/api/my-app", "/app/my-app", "/admin/my-app", "/public/my-app"],
});

export const { ssr, plugin } = app;
```

That example uses Bun + SolidJS because the shared helpers (UI, auth, services) are TypeScript. Other languages work too — any HTTP service that talks Redis and Postgres can register with the gateway.

## How it works

```
                          HTTPS
                            │
                            ▼
                    ┌───────────────┐
                    │    Gateway    │   routes /app/<id>/* by URL prefix
                    └───┬───┬───┬───┘
                        │   │   │
            ┌───────────┘   │   └───────────┐
            ▼               ▼               ▼
       ┌─────────┐     ┌─────────┐     ┌─────────┐
       │  core   │     │  files  │     │   ...   │   each app:
       │         │     │         │     │         │   Bun + Hono + SolidJS SSR
       └────┬────┘     └────┬────┘     └────┬────┘   one container per app
            └───────────────┴────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
           ┌─────────┐            ┌──────────┐
           │  Redis  │            │ Postgres │
           │  Valkey │            │          │
           └─────────┘            └──────────┘
       sessions, service           per-app
       registry, cache             schemas
```

Each app boots, registers itself with the gateway through Redis, and starts handling requests at its declared URL prefix. The gateway holds no per-app code — adding an app touches only that app's own files and the compose file.

Apps share the Postgres instance (each owns its own schema) and the Redis instance (sessions, service registry, ratelimits, snapshot cache). Per-app traffic, latency and route-trace data live in the gateway and are visible in the admin UI.

## Quick start

```bash
bun install --frozen-lockfile
bun run infra      # postgres, valkey, geo, filegate, gotenberg
bun run dev        # core 6-container set
open http://localhost:3000
```

Development requires Bun 1.x, Docker, and Docker Compose v2. The Docker development stack gets its local database, Redis, app-secret, and admin-token values from `compose.dev.yml`; no `.env` file is required. `.env.example` is only a reference for running processes directly on the host or building a custom local setup. Production uses `.env.prod.example` as its companion template.

Dev admin login: open `/auth/login?method=admin` and paste `dev-admin` into the token field (the `ADMIN_LOGIN_TOKEN` baked into `app-core`).

| Command | What it does |
|---|---|
| `bun run dev` | Core 6 services (gateway, gateway-ops, core, dashboard, accounts, assistant) |
| `bun run dev:full` | Core + 17 dev extras via the `extra` profile (23 services total) |
| `bun run dev:start <app...>` | Add one or more extra apps to the running stack |
| `bun run dev:stop <app...>` | Stop one or more apps |
| `bun run dev:rebuild <app...>` | Rebuild image + restart (parallel for multiple) |
| `bun run dev:logs <app>` | Follow one app's logs |
| `bun run dev:status` | Plain-text inventory of all apps (state, uptime, image age) |
| `bun run dev:help` | Catalog of every dev command |
| `bun run dev:down` | Tear the dev stack down |
| `bun run typecheck` | skills + boundaries + cycles + biome + tsc |

## Agent-assisted development

After a fresh clone, start the documentation and install its current developer
skill:

```bash
bun install --frozen-lockfile
bun run dev:fibel
bunx skills add http://localhost:4187
```

Connect the same local documentation as an MCP server. Use the command for
your agent:

```bash
# Codex
codex mcp add cloud-dev-mcp --url http://localhost:4187/_fibel/mcp

# Claude Code
claude mcp add --transport http cloud-dev-mcp http://localhost:4187/_fibel/mcp
```

For another code agent, configure a streamable HTTP MCP server named
`cloud-dev-mcp` with the same URL and load `AGENTS.md` as repository guidance.
The **Agents** dialog in the Fibel footer shows additional client-specific
setup.

If Fibel starts on another port, replace `4187` in both commands. Restart the
agent session after adding the connection. The agent should see the Docs and
UI collections through `list_collections`, `search_docs`, and `read_doc`.

Repository-wide agent instructions live in [`AGENTS.md`](AGENTS.md). Claude
Code loads the same instructions through [`CLAUDE.md`](CLAUDE.md). The
canonical contribution rules are in
[`Document Cloud core changes`](docs-site/docs/en/contributing/document-cloud-core-changes.md).

Install the CLI operator skill directly from the repository:

```bash
bunx skills add github.com/ValentinKolb/cloud
```

- `cloud-dev` — building and maintaining Cloud applications with current documentation through Fibel MCP
- [`cloud-cli`](skills/cloud-cli/SKILL.md) — using a Cloud instance from the terminal with `cld`

## License

GNU Affero General Public License v3.0 or later — see [LICENSE](./LICENSE).

Commercial use, hosting, modification, and redistribution are permitted under
the AGPL. If you modify Cloud and let users interact with it over a network,
you must provide those users access to the corresponding source code under the
same license.

Separate commercial licenses for proprietary, reseller, managed-service,
white-label, or embedded product use are available by contacting the maintainer.
