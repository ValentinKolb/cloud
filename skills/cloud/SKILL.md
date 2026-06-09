---
name: cloud
description: >
  Overview of the StuVe Cloud platform — architecture, tech stack, auth model, core services, and helper libraries.
  Use this skill when the user asks about the cloud platform in general, wants to understand the architecture,
  asks about authentication/authorization, needs to know what services or libraries are available,
  or wants to get started with the platform. Also use when explaining the platform to end users
  (e.g. how to log in as a local admin).
---

# StuVe Cloud Platform

The StuVe Cloud is a **modular application platform** — think of it as an internet OS for building internal tools.
It is NOT a cloud storage solution like Nextcloud. It is a framework that provides authentication, authorization,
notifications, logging, settings management, and more — so that app developers can focus on their domain logic.

## Tech Stack

| Layer       | Technology                                                                 |
|-------------|---------------------------------------------------------------------------|
| Runtime     | **Bun** (TypeScript-first, fast startup, native SQL/Redis/WebSocket)      |
| HTTP        | **Hono** (lightweight, typed routes, OpenAPI integration)                 |
| UI          | **SolidJS** (reactive, fine-grained updates, SSR-first via islands)       |
| Database    | **PostgreSQL 15** (one schema per app, raw SQL via `sql` template tag)    |
| Cache/Pub   | **Valkey** (Redis-compatible — sessions, service registry, pub/sub)       |
| Styling     | **Tailwind CSS** + custom utility classes                                 |
| Icons       | **Tabler Icons** (`ti ti-*` classes)                                      |

### Helper Libraries (external, with their own skills)

These are standalone packages on GitHub. Each has its own Claude skill — prefer those skills for detailed API questions.

- **`@valentinkolb/stdlib`** — Encoding, hashing, crypto, dates, file helpers, SolidJS primitives (`mutation.create`, `debounce`, `hotkeys`), browser utilities. [github.com/ValentinKolb/stdlib](https://github.com/ValentinKolb/stdlib)
- **`@valentinkolb/sync`** — Distributed primitives: rate limiting, mutexes, durable queues/jobs, schedulers, topic streams, and ephemeral state. The cloud app registry is implemented with `ephemeral<T>` plus a prefix filter, not the removed v4 `registry` module. [github.com/ValentinKolb/sync](https://github.com/ValentinKolb/sync)
- **`@valentinkolb/ssr`** — Minimal SolidJS islands SSR framework for Bun/Hono. Pages render server-side, islands hydrate client-side. [github.com/ValentinKolb/ssr](https://github.com/ValentinKolb/ssr)

## Architecture Overview

```
                    ┌─────────────┐
                    │   Gateway    │  ← HTTP entry point (port 3000)
                    │  (Hono app)  │     dynamic routing via Redis registry
                    └──────┬──────┘
                           │ proxy
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │  cloud-core │ │ app-files   │ │ app-weather  │ ...  ← each app = min 1 HTTP container
   │  (auth,home)│ │             │ │              │
   └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
          │                │                │
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌────────────────┐
   │ PostgreSQL  │  │   Valkey    │◄─┤ gateway-ops    │
   │  (schemas)  │  │  (sessions, │  │ admin, bg jobs │
   │             │  │   registry) │  └────────────────┘
   └─────────────┘  └─────────────┘
```

### Key Principles

- **One HTTP container per app** — each app runs as an independent Bun process with its own Hono server on port 3000
- **Keep edge routers thin** — the gateway router owns only route discovery, local trie matching, proxying, minimal health, and telemetry publication. Gateway admin UI, rollups, health webhooks, and cleanup live in the normal `gateway-ops` app lifecycle.
- **Horizontal scaling** — apps are stateless; scale by running more containers behind the gateway
- **Service discovery via Redis** — apps register themselves in a Redis-based registry with heartbeats; the gateway watches for changes and routes accordingly
- **Schema isolation** — most apps own their own PostgreSQL schema (e.g. `files.*`, `notebooks.*`, `spaces.*`). Platform schemas such as `auth.*`, `logging.*`, `settings.*`, and `notifications.*` belong to core services, not to standalone app packages.
- **SSR-first** — pages render server-side; only interactive parts become client-side "islands"

### Core-Owned Domains

Some domains are deliberately NOT apps — they live in `@valentinkolb/cloud` (`packages/cloud/`) and are shared across every container. The intent: swap the UI, keep the semantics.

| Domain | Where it lives | Why it's core |
|--------|----------------|---------------|
| **Accounts / auth** | `packages/cloud/src/services/{accounts,account-lifecycle,auth-flows,ipa,providers,session,service-accounts,service-account-credentials,oauth-tokens}/` + `packages/core/src/migrate/core/auth.ts` | Auth is a platform invariant. Every app depends on the same user/role/session/principal model. Provider switching, IPA sync, magic-link, service accounts, API credentials, OAuth bearer verification, account lifecycle, and session semantics must not diverge between deployments. |
| **Logging, notifications, settings** | `packages/cloud/src/services/{logging,notifications,settings}/` + `packages/core/src/migrate/core/*.ts` | Same reasoning — platform primitives, not app features. |

The `packages/accounts/` app is **pure admin UI** on top of `@valentinkolb/cloud/services/accounts`. It owns no schema, no service logic, no auth flows. A user may fork it or write a completely different admin frontend, but the underlying authentication, authorization, and account-lifecycle rules stay identical. `packages/gateway-ops/` plays the same role for gateway operations, logging, notifications, and settings UI: it renders and schedules platform operations, while the reusable service logic stays in `@valentinkolb/cloud`.

Rule of thumb: if it touches `auth.*` tables, implements an auth flow, or defines role/permission semantics — it belongs in `packages/cloud/`, never in an app.

### You Don't Have to Use the Built-in Stack

As long as your app speaks **PostgreSQL** and **Redis** (for service registry), you can write it in any language or framework. The built-in Bun/Hono/SolidJS stack just gives you a lot of helpers for free.

## App Model

Every app is defined via `defineApp()` in `config.ts` and started via `app.start()` in `index.ts`:

```typescript
// config.ts
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "my-app",
  name: "My App",
  icon: "ti ti-star",
  description: "What this app does.",
  basePath: "/app/my-app",
  baseUrl: "http://app-my-app:3000",
  nav: { href: "/app/my-app", section: "primary", requiresAuth: true },
});

export const { ssr, plugin } = app;
```

```typescript
// index.ts
import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/my-app", apiRoutes)
  .route("/app/my-app", pageRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,                              // optional, opt-in to /app/api-docs
  lifecycle: { setup, start, stop },
  capabilities: { search: { run: searchHandler } },
});
```

`defineApp()` creates the SSR config, plugin, and page handler. The framework owns `/_ssr/*`, `/public/*`, `/api/_internal/search` (when `capabilities.search` is set) and the OpenAPI mount (when `defineApp({ openapi })` + `app.start({ openapi })` are paired) — these register before the user fetch. Apps compose their own router with the middleware they need (`middleware.runtime`, `middleware.settings`, `middleware.logger`, `middleware.ratelimit`) and pass the resulting `.fetch` in. `app.start()` also handles Redis heartbeat, static file serving, and graceful shutdown. See the `cloud-app` skill for the full app-building guide.

## Auth Model

> For the detailed auth model (role derivation, group hierarchy, session internals), read `references/auth-model.md`.

### User Types

| Provider | Profile | Description |
|----------|---------|-------------|
| `ipa`    | `user`  | Full Kerberos account managed in FreeIPA (single source of truth) |
| `ipa`    | `guest` | FreeIPA account in sync scope but outside the configured full-user realm |
| `local`  | `user`  | Email-only local account, login via magic link |
| `local`  | `guest` | Email-only visitor, auto-expiring, login via magic link |

All local users (both `user` and `guest`) authenticate via **magic link email login** — there is no password. The platform sends a time-limited login link to the user's email address.

**Special case: Admin token login.** When `ADMIN_LOGIN_TOKEN` is set, a hidden endpoint accepts the token as password. This auto-creates a `local|user` admin account (uid `"admin"`, admin flag `true`). Internally it's a regular local user — only the login mechanism is different.

**FreeIPA is the single source of truth** for IPA users. Full sync derives IPA scope, profile, and admin state from the FreeIPA group graph and mirrors the result in PostgreSQL for fast queries. Local users are fully managed in PostgreSQL.

### Roles

Roles are **computed** by `buildRoles()` from a user's provider, profile, group memberships, and admin flag:

- `user` / `guest` — profile-based (always present)
- `ipa` / `local` — provider-based (always present)
- `ipa/user`, `ipa/guest`, `local/user`, `local/guest` — compound (always present)
- `admin` — if local admin flag is true OR an IPA user is effectively in an admin group (guests cannot be admin)
- `group-manager` — manages at least one group (guests cannot be group-manager)
- `authenticated` — special middleware role, not stored in roles array; checked implicitly by middleware for any logged-in user

### Auth Middleware

Routes protect themselves with middleware:

```typescript
import { auth } from "@valentinkolb/cloud/server";

app
  .use(auth.requireRole("authenticated"))           // any logged-in user
  .get("/admin", auth.requireRole("admin"), ...)     // admin only
  .get("/page", auth.requireRole("*"), ...)          // load user if present, but don't require
  .get("/login", auth.requireRole("anonymous"), ...) // only non-logged-in users
```

The middleware resolves every authenticated request to a `RequestActor` and an
`AccessSubject`:

- Browser/session user → `actor.kind = "user"`, `accessSubject = { type: "user" }`
- User-bound API key or user-delegated service account → `actor.kind = "service_account"` plus `delegatedUser`; permissions behave like the linked user
- Resource-bound API key or OAuth service token → `actor.kind = "service_account"` with no user; permissions come from explicit service-account grants

`c.get("user")` remains a compatibility path for normal users and
user-delegated service accounts. New permission-aware code should prefer
`c.get("actor")` and `c.get("accessSubject")`, because resource-bound service
accounts intentionally do not have a fake user.

Bearer tokens are resolved after cookie sessions. `cld_<prefix>_<secret>` API
keys use `serviceAccountCredentials`; OAuth access tokens are verified via the
OAuth app's signing key and must have `token_use = "access"` and audience
`"cloud"`.

## Core Services

These are provided by the `@valentinkolb/cloud` package. Import paths:

| Path | Content |
|------|---------|
| `@valentinkolb/cloud` | `defineApp`, app registry, `createHeartbeat`, `buildRuntimeFromRegistry` |
| `@valentinkolb/cloud/server` | `auth`, `v`, `respond`, `ok`, `fail`, `err`, `rateLimit`, `jsonResponse`, access helpers, timezone helpers |
| `@valentinkolb/cloud/services` | `logger`, `logging`, `notifications`, `session`, `accounts`, `serviceAccounts`, `serviceAccountCredentials`, `oauthTokens`, `audit`, postgres helpers |
| `@valentinkolb/cloud/services/settings` | `get`, `set`, `remove`, `getAll`, `loadCache` — all reads are async (cache-aside through Redis) |
| `@valentinkolb/cloud/ui` | All UI components, `prompts`, `DialogHeader`, `AppOverview`, `AppWorkspace`, `DataTable`, `FilterChip`, `Pagination`, etc. |
| `@valentinkolb/cloud/browser` | `api.create()` (typed Hono client), `copyToClipboard` |
| `@valentinkolb/cloud/ssr` | `Layout`, `AdminLayout`, `getRuntimeContext` |
| `@valentinkolb/cloud/contracts` | Zod schemas, types (`Role`, `User`, `PaginationQuerySchema`, etc.) |
| `@valentinkolb/cloud/shared` | Date/encoding/icon helpers |
| `@valentinkolb/cloud/config` | `env` (environment variables) |

### Logging

```typescript
import { logger } from "@valentinkolb/cloud/services";

const log = logger("my-app:feature");
log.info("Something happened", { key: "value" });  // → console + DB (fire-and-forget)
```

Stored in `logging.entries` (level, source, message, metadata JSONB). Auto-cleanup after configurable retention days.

### Notifications

```typescript
import { notifications } from "@valentinkolb/cloud/services";

await notifications.send({
  type: "email",
  recipient: "user@example.com",
  subject: "Welcome",
  rawHtml: "<h1>Hello</h1>",
  autoSend: true,
});
```

### Settings

Runtime-configurable key-value store, encrypted at rest, cached in Redis (cache-aside, 5-minute TTL):

```typescript
import * as settings from "@valentinkolb/cloud/services/settings";

const value = await settings.get<number>("logs.retention_days"); // async, Redis-cached
await settings.set("logs.retention_days", 60);                   // async, updates DB + cache
```

Inside an HTTP handler prefer the per-request snapshot on `c.get("settings")` (sync, frozen for the request) — it's populated by `middleware.settings()` and avoids the Redis round-trip on every read. Fall back to `await settings.get(...)` outside the request lifecycle (background jobs, lifecycle hooks).

App-owned settings are declared inside `defineApp({ settings: { ... } })` as a typed map (see the `cloud-app` skill). The platform registers them automatically and they appear in the admin settings UI grouped by the dotted-key prefix. They support env-var fallbacks; resolution order: DB value → env fallback → code default.

### Timezones

Store user-facing instants as UTC ISO strings or database timestamps. Date-only values stay date-only (`YYYY-MM-DD`). Rendering and parsing user-facing date/time values should go through `@valentinkolb/stdlib` date helpers with a request-specific date context.

Inside HTTP handlers use the KISS server helpers from `@valentinkolb/cloud/server`:

```typescript
import { getDateConfig, getTimeZone } from "@valentinkolb/cloud/server";

const dateConfig = getDateConfig(c); // stdlib DateContext
const timeZone = getTimeZone(c);     // string, mostly for logs/jobs
```

Resolution order is: browser `cloud.timezone` cookie → global `app.timezone` setting → `UTC`. `Layout` includes the small browser island that writes the cookie with `@valentinkolb/stdlib/browser` cookie helpers. Do not add app-local timezone stores or duplicate date formatting wrappers unless the component truly needs extra behavior.

Background jobs and schedulers do not have a browser cookie, so they use `app.timezone` as their wall-clock timezone. Server-rendered UI should pass `getDateConfig(c)` into time-aware islands/components and let them call stdlib `dates.*`.

### Session

Redis-backed sessions with configurable TTL. Token format: `${userId}:${randomToken}`, stored in cookie (`session_token`) or Bearer header. See `references/auth-model.md` for details.

## Universal Search

Apps can opt into platform-wide search by implementing `capabilities.search` in their `app.start()` call. The gateway aggregates results from all registered apps. See the `cloud-app` skill for implementation details.

## Local Admin Login (Development)

For local development without FreeIPA, set the environment variable:

```
ADMIN_LOGIN_TOKEN=dev-admin
```

Then navigate to `/auth/login?method=admin` and paste the token value (`dev-admin`) into the single token field. This bypasses FreeIPA and auto-creates a `local|user` admin account (uid `"admin"`). **Never use this in production.**

## Existing Apps (Reference)

Built-in apps serve as reference implementations. The most instructive ones:

| App | Good example of... |
|-----|-------------------|
| [cloud-template](https://github.com/ValentinKolb/cloud-template) | Standalone reference app (separate repo) — tenancy, child items, permissions, admin, widget, email, logging |
| `gateway-ops` | Admin sidebar grouping, gateway apps/routes, logs, telemetry, webhooks, settings, notifications |
| `files` | Sidebar layout, file operations, Filegate integration |
| `spaces` | Card grid layout, CRUD with forms, permissions |
| `contacts` | Multi-column layout, sidebar + list + detail panel |
| `weather` | Simple sidebar + detail, external API integration |
| `quotes` | Minimal app (API-only, widget, no frontend pages) |
| `accounts` | Complex CRUD, FreeIPA integration, group management |

Source: `packages/{app-id}/src/`

## Next Steps

- **Building a new app?** → Use the `cloud-app` skill
- **Deploying?** → Use the `cloud-ops` skill
- **Using stdlib/sync/ssr?** → Use their dedicated skills
