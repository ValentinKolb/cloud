---
name: cloud-dev
description: >
  Build and maintain apps on the Cloud platform — the self-hosted Bun + Hono + SolidJS application platform
  (`@valentinkolb/cloud`). Covers app anatomy, backend services and Hono APIs, SolidJS SSR pages and islands,
  the shared UI component system and visual design language, auth and resource permissions, app Help, app CLI
  modules, and the dev/deploy loop. Use this skill whenever creating a new Cloud app, adding features to an
  existing one, writing API routes, service logic, SQL or migrations, building frontend pages or islands,
  working with the UI kit, or running and deploying the platform. Applies equally to built-in apps inside the
  Cloud monorepo and standalone third-party apps built against the published npm package. For *using* an
  existing Cloud instance from the terminal, use the `cloud-cli` skill instead.
---

# Building on Cloud

Cloud is a **modular application platform** — an internet OS for internal tools. It is not a storage product. It provides authentication, authorization, notifications, logging, settings, a UI kit, search, and admin surfaces, so that an app only has to bring its domain logic.

## One flow, two homes

An app is the same thing whether it lives inside the Cloud monorepo or in its own repository against the published npm package. Same `defineApp`, same services, same UI, same auth, same deployment model. **Everything in this skill applies to both** unless a block is explicitly marked.

Only three things fork:

| | Built-in (monorepo) | Standalone (npm) |
|---|---|---|
| Where the app lives | `packages/<id>/`, depending on `"@valentinkolb/cloud": "workspace:*"` | your own repo root, depending on `"@valentinkolb/cloud": "^0.5"` plus its peers — `solid-js`, `hono` and `zod` |
| How it registers with the stack | service block in `compose.dev.yml` + a `COPY` line in `Dockerfile.dev` | your own compose file, pulling prebuilt platform images from ghcr |
| Dev command | `bun run dev:start <id>` | `docker compose up` |

The starter for standalone apps is [cloud-template](https://github.com/ValentinKolb/cloud-template) — platform images from ghcr plus your app built locally, no monorepo and no workspace. Details for both in `ops.md`.

Framework-maintainer tooling (`check:cycles`, `check:ui-lab`, `check:css`, `check:service-api-contracts`) is not app-author tooling and is not part of this flow.

## Use the libraries; do not rebuild them

Cloud sits on three standalone packages. They are the default, not an implementation detail, and **nothing they provide should be reimplemented in Cloud or in an app.** Each has its own skill — use it for API detail.

| Package | You get | Skill |
|---|---|---|
| `@valentinkolb/stdlib` | `Result`/`ok`/`fail`/`err`, `mutation.create`, date helpers, `hotkeys`, `detailPanel`, encoding/hashing/crypto, browser helpers | `stdlib` |
| `@valentinkolb/sync` | Distributed primitives: `topic`, `job`, `queue`, `scheduler`, `ephemeral`, rate limits, mutexes | `sync` |
| `@valentinkolb/ssr` | The islands SSR framework, plus all navigation helpers (`navigateTo`, `refreshCurrentPath`, `navigate`, `Link`, …) | `ssr` |

Install the skills — this works in Claude Code, Codex, and any other agent that reads the standard skills directory:

```bash
bunx skills add valentinkolb/stdlib
bunx skills add valentinkolb/sync
bunx skills add valentinkolb/ssr
```

Cloud re-exports a few of these for convenience — `ok`/`fail`/`err` are available from `@valentinkolb/cloud/server`. **Navigation helpers are not re-exported:** import them from `@valentinkolb/ssr/nav`.

Before writing a helper, check whether one of these already owns it. A local reimplementation of a queue, a debounce, a date formatter, or a scroll restorer is a bug.

## App anatomy

```
<app-root>/
├── package.json
├── tsconfig.json
└── src/
    ├── config.ts            # defineApp() — identity, settings, widgets, notifications
    ├── index.ts             # app.start() — the entry point
    ├── contracts.ts         # Zod schemas for input/output
    ├── migrate.ts           # idempotent DDL, runs on every startup
    ├── notifications.ts     # typed end-user notification definitions
    ├── api/
    │   ├── index.ts         # Hono router; exports ApiType
    │   ├── client.ts        # typed Hono client for the frontend
    │   └── items.ts         # one file per resource
    ├── service/             # business logic, stateless functions
    ├── styles/app.css       # Tailwind entrypoint — required
    └── frontend/
        ├── index.ts         # explicit route → page mapping
        ├── page.tsx
        └── _components/
            └── ItemList.island.tsx
```

### config.ts

```typescript
import { defineApp } from "@valentinkolb/cloud";
import { NOTIFICATIONS } from "./notifications";

export const app = defineApp({
  id: "my-app",                        // unique; used in URLs and the registry
  name: "My App",
  icon: "ti ti-star",                  // Tabler icon class
  description: "What this app does.",
  basePath: "/app/my-app",             // SSR asset prefix
  baseUrl: "http://app-my-app:3000",   // container URL for service discovery
  routes: ["/api/my-app", "/app/my-app", "/admin/my-app", "/public/my-app"],
  //        └ API        └ pages        └ admin pages    └ STATIC ASSETS ONLY — see below
  nav: { href: "/app/my-app", section: "primary", requiresAuth: true },
  adminHref: "/admin/my-app",
  appearance: { accent: "#217346", background: { from: "#217346", strength: 20 } },
  widgets: [{ id: "today", path: "/api/my-app/widget/today" }],
  notifications: NOTIFICATIONS,
  settings: {
    "my-app.feature_enabled": {
      kind: "boolean",
      label: "Enable feature X",
      default: true,
      description: "Whether feature X is active.",
    },
  },
  openapi: "/api/my-app/openapi.json",  // opt into the platform API-docs aggregator
});

export const { ssr, plugin } = app;
```

`routes` is **required** — it declares the top-level URL prefixes the gateway routes to this container. `nav.section` is `"primary"` (in the rail), `"more"` (launchpad only), or `"hidden"`.

> **`/public/<id>` is framework-owned static asset delivery, not a page namespace.** The framework mounts `/public/*` *before* your fetch and it is terminal, so a page you register there is unreachable. Anonymous-facing HTML needs its own prefix — `/share/my-app` is the established choice — declared in `routes` like any other. It still does its own token or resource validation server-side; `auth.requireRole("*")` is the route shape for a page that serves both anonymous and signed-in visitors.

All app identity lives here, in one place: nav, widgets, notifications, settings, admin links, appearance. `defineApp()` returns the SSR config, the island bundler plugin, and the `ssr` page wrapper.

### index.ts

```typescript
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import { app } from "./config";
import apiRoutes from "./api";
import pageRoutes, { adminPages } from "./frontend";
import { migrate } from "./migrate";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())    // c.get("runtime") — required by Layout
  .use("*", middleware.settings())   // c.get("settings") — typed snapshot
  .route("/api/my-app", apiRoutes)
  .route("/app/my-app", pageRoutes)
  .route("/admin/my-app", adminPages);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,                 // pair with defineApp({ openapi })
  lifecycle: {
    setup: async () => { await migrate(); },
    start: async (ctx) => { /* background jobs */ },
    stop: async (ctx) => { /* cleanup */ },
  },
  // capabilities: { search: … }  ← optional; contract in backend.md
});

export type { ApiType } from "./api";
```

**The framework injects no middleware implicitly.** You compose your own router and hand `.fetch` to `app.start()`. The framework only mounts `/_ssr/*`, `/public/*`, `/api/_internal/search` (when `capabilities.search` is set), and the OpenAPI spec — all before your fetch, so the spec is public.

`app.start()` also owns the registry heartbeat, static files, and graceful shutdown.

### styles/app.css

```css
@import "tailwindcss/utilities.css" layer(utilities);
@source "../**/*.{ts,tsx}";
@custom-variant dark (&:where(.dark, .dark *));
```

Required — the CSS build needs it. The `@source` scan is deliberately scoped to **this app's own** files: framework classes arrive via `global.css`, served by the core container. Never scan another app's source, and never import framework styles here.

## The rules that matter most

Violating these produces code that looks fine and is wrong.

1. **Resolve every request through `actor` and `accessSubject`.** `c.get("user")` no longer exists in app code — `check:boundaries` fails on it — because it was typed `User` while being `undefined` for a resource-bound principal, so checks written against it compiled and silently excluded API keys. When a feature needs the user for roles or display, derive it from the actor with `expectUserBackedActor`. The related trap: never authorize from `User.memberofGroupIds`, which is display metadata the access helpers ignore. → `auth.md`
2. **SSR pages must repeat their permission checks.** They call services directly, so route middleware never ran. → `backend.md`
3. **Never filter, sort, paginate, or aggregate in the browser.** The client owns *intent*; the server owns the *result set*. A client-side filter sees only the rows it was already given, cannot apply access conditions, and breaks reload and sharing. Push it into the URL, then into SQL. → `frontend.md`
4. **Every user-initiated write goes inside `mutation.create()`** — including the `prompts.form()` that precedes it, because the prompt can fail or be cancelled too. Never hand-roll loading/error signals. (Read-only route-state loaders and live-stream sync own their own lifecycle and are the documented exception.) → `frontend.md`
5. **Use the typed Hono client, never raw `fetch()`, for app JSON APIs.** If the client's types are weak, fix the route — do not cast. → `backend.md`
6. **Never group ordinary content with horizontal lines.** No `<hr>`, `divide-y`, or full-width `border-t`/`border-b`. → `design.md`
7. **Migrations are idempotent and never add-then-drop a column.** Postgres counts dropped columns against the 1600 limit. → `backend.md`
8. **Auth, sessions, roles, principals, and credentials are core.** An app that implements one of those is in the wrong place. → `architecture.md`
9. **Workflow runs, leases, retry, crash recovery and the effect journal are the kernel's.** An app brings action implementations and an event vocabulary; a run table, a lease or a `beginEffect`/`settleEffect` pair in an app is a rewrite of something that already exists. → `workflows.md`

## Where to look

Read a reference when its condition applies. Do not preload them.

| Read | When |
|---|---|
| `architecture.md` | You need the platform shape — gateway, registry, containers, schema ownership — or you are unsure whether something belongs in core or in an app. |
| `backend.md` | Writing services, SQL, migrations, Hono routes, contracts, background jobs, logging, or the typed client. |
| `frontend.md` | Building any UI: SSR pages, choosing a shell, islands, mutations, navigation, URL state. **Start here for frontend work**, then go to `components.md` for a specific component. |
| `components.md` | You need the exact props of a shared component, an input, or a CSS utility class. Lookup reference — do not read end to end. |
| `design.md` | Making a visual or interaction decision: hierarchy, spacing, surfaces, colour, states, responsive, dark mode. Read **before** styling anything new. |
| `auth.md` | Protecting a route, checking a resource permission, or working on accounts, sessions, groups, or service accounts. |
| `api-keys.md` | An app resource needs API keys for automation or integrations. |
| `help.md` | Writing or changing end-user Help for an app. |
| `workflows.md` | The app needs user-authored automation. Declaring actions and events, wiring them into a worker, emitting events, effects and budgets. **Never write a run engine — the kernel owns runs, leases, retry, recovery and the effect journal.** |
| `cli.md` | Adding or changing an app's `cld` CLI module. |
| `ops.md` | Running the stack, adding a container, env vars and settings, building, or deploying. |
| `checklist.md` | Before calling any change done. |

## Judging existing code

This repository is a working codebase, not a reference implementation. Apps drift, and some patterns in them are wrong.

When you need to know how something should be done, the order is: **the shared primitive's source**, then **`design.md`**, then an existing app as an *example*. An app that contradicts the first two is a bug in that app. Where two apps disagree, neither is authority — derive the answer from the primitive. Size is not quality: the largest and newest packages are also the ones most in flux.

## Next steps

- **New app?** Follow `architecture.md` for the boundary, then `backend.md` and `frontend.md`, then `ops.md` to run it.
- **Existing app?** Go straight to the reference for the layer you are touching.
- **Using a Cloud instance rather than building one?** That is the `cloud-cli` skill.
