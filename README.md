<p align="center">
  <img src="./packages/cloud/public/logo.svg" alt="Cloud" width="96" height="96">
</p>

<h1 align="center">Cloud</h1>

<p align="center">
  <em>Self-hosted application platform.</em>
</p>

Cloud bundles a set of apps that cover the common operational needs of an organisation — accounts, settings, logging, notifications, files, notebooks, calendars, OAuth — and is built around the custom apps you write yourself. Custom apps get the same session, UI kit, search hooks, and admin pages as the apps in the box.

## Highlights

- **Built around your own apps.** Adding an app is one config file plus a Dockerfile. The platform picks it up at runtime.
- **Per-app deployment.** Every feature is a separate Bun container, started, updated and scaled on its own.
- **Horizontal scaling.** Apps are stateless and discovered through a Redis-backed registry — `docker compose up --scale notebooks=3` and the gateway routes across all instances.
- **Bun + Hono + SolidJS + Postgres + Redis.** End-to-end TypeScript.
- **Admin surface for everything.** Per-app admin pages, settings managed in the UI, requests route-traced through the gateway.

## What ships

| Group | Apps |
|---|---|
| **Platform** | [`core`](packages/core) — auth, profile, admin login &nbsp;•&nbsp; [`gateway`](packages/gateway) — routing, app registry, request traces |
| **Identity & access** | [`accounts`](packages/accounts) — users + groups, FreeIPA and local &nbsp;•&nbsp; [`oauth`](packages/oauth) — OAuth2 issuer &nbsp;•&nbsp; [`proxy-auth`](packages/proxy-auth) — Traefik forward-auth &nbsp;•&nbsp; [`ipa-hosts`](packages/ipa-hosts) — FreeIPA host management |
| **Operations** | [`settings`](packages/settings) — system + per-app settings, legal docs &nbsp;•&nbsp; [`logging`](packages/logging) — structured logs with admin viewer &nbsp;•&nbsp; [`notifications`](packages/notifications) — transactional email |
| **Productivity** | [`notebooks`](packages/notebooks) — collaborative notes (Yjs) &nbsp;•&nbsp; [`spaces`](packages/spaces) — kanban / list / calendar with iCal &nbsp;•&nbsp; [`files`](packages/files) — shared storage &nbsp;•&nbsp; [`contacts`](packages/contacts) — directory views |
| **Content & misc** | [`faq`](packages/faq) &nbsp;•&nbsp; [`weather`](packages/weather) &nbsp;•&nbsp; [`quotes`](packages/quotes) &nbsp;•&nbsp; [`tools`](packages/tools) |
| **Development** | [`ui-lab`](packages/ui-lab) — component showcase |

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
bun install
bun run infra      # postgres, valkey, geo, filegate
bun run dev        # core 7-container set
open http://localhost:3000
```

Dev admin login: open `/auth/login?method=admin` and paste `dev-admin` into the token field (the `ADMIN_LOGIN_TOKEN` baked into `app-core`).

| Command | What it does |
|---|---|
| `bun run dev` | Core 7 containers (gateway, core, dashboard, accounts, logging, settings, notifications) |
| `bun run dev:full` | All containers, every app on |
| `bun run dev:app <name>` | Add one extra app to the running stack |
| `bun run dev:app stop \| logs <name>` | Stop / tail one app |
| `bun run typecheck` | skills + boundaries + cycles + biome + tsc |
| `bun run dev:down` | Tear the dev stack down |

## Agent skills

```bash
bunx skills add github.com/ValentinKolb/cloud
```

- [`cloud`](skills/cloud/SKILL.md) — architecture overview
- [`cloud-app`](skills/cloud-app/SKILL.md) — building apps (frontend + backend reference)
- [`cloud-ops`](skills/cloud-ops/SKILL.md) — dev, deploy, compose

## License

MIT — see [LICENSE](./LICENSE).
