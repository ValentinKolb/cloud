# Platform architecture

How Cloud is put together, and — more usefully — where the boundary runs between the platform and an app.

## Shape

```
                          HTTPS
                            │
                            ▼
                    ┌───────────────┐
                    │    Gateway    │   routes by URL prefix, no per-app code
                    └───┬───┬───┬───┘
                        │   │   │
            ┌───────────┘   │   └───────────┐
            ▼               ▼               ▼
       ┌─────────┐     ┌─────────┐     ┌─────────┐
       │  core   │     │  mail   │     │   ...   │   one container per app
       └────┬────┘     └────┬────┘     └────┬────┘   Bun + Hono + SolidJS SSR
            └───────────────┴────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
           ┌─────────┐            ┌──────────┐
           │  Redis  │            │ Postgres │
           │ (Valkey)│            │          │
           └─────────┘            └──────────┘
       sessions, app registry,     one schema
       rate limits, pub/sub        per app
```

An app boots, registers itself in the Redis app registry, and starts serving its declared URL prefixes. The gateway watches the registry and rebuilds a local prefix trie when it changes. There is no central registration file: adding an app touches only that app's own files plus the compose file that runs it.

## Service discovery

`app.start()` installs a heartbeat that writes the app's registry entry every **60 s**. The entry TTL is **180 s** — three missed heartbeats before an instance is considered gone. A new container is therefore routable within seconds of its first heartbeat, and a crashed one drains without manual intervention.

The registry entry carries the app id, nav metadata, `baseUrl`, declared `routes`, and the OpenAPI URL when the app advertises one. Several containers of the same app can register concurrently; the gateway load-balances across them, which is why **apps must be stateless**. Anything that must survive a request lives in Postgres or Redis.

The registry is built on `@valentinkolb/sync`'s `ephemeral<T>` plus a prefix filter — not a bespoke registry implementation, and not the removed v4 `registry` module.

## The gateway is deliberately thin

The gateway owns route discovery, trie matching, HTTP and WebSocket proxying, a minimal `/health`, and telemetry publication. That is all.

Everything operational — the admin UI, telemetry rollups, health webhooks, cleanup jobs, log and notification APIs — lives in `gateway-ops`, which is an ordinary Cloud app with an ordinary lifecycle. Keep it that way: work added to the edge router cannot be scaled, restarted, or replaced independently.

## Core-owned domains

Some domains are deliberately not apps. They live in `@valentinkolb/cloud` and are shared by every container. The intent: **swap the UI, keep the semantics.**

| Domain | Why it is core |
|---|---|
| Accounts, auth, sessions, principals | Every app depends on the same user/role/session model. Provider switching, IPA sync, magic-link, passkeys, service accounts, API credentials, OAuth verification, and account lifecycle must not diverge between deployments. |
| Logging, notifications, settings | Platform primitives, not app features. Core also owns the platform settings UI and the public legal pages. |

`packages/accounts` is **pure admin UI** on top of `@valentinkolb/cloud/services/accounts`. It owns no schema, no service logic, no auth flow. It exists so an operator can fork or replace the admin frontend without touching auth semantics. `gateway-ops` plays the same role for gateway operations and observability.

**Rule of thumb:** if it touches `auth.*`, implements an auth flow, or defines role or permission semantics, it belongs in core — never in an app.

## What belongs in an app

Apps are domain features *on top of* the platform. They must not redefine platform primitives.

Keep out of apps:

- Auth flows, session semantics, role and permission logic. A new login flow or role type is a core change.
- The `auth.*` schema and anything that writes to it. Apps reference `auth.users(id)` by foreign key; they never migrate or mutate those tables.
- Account lifecycle, IPA sync, provider switching, magic-link issuance.
- Service-account identity, API credential hashing, OAuth token verification. Core owns principals and bearer-token resolution; the OAuth app owns authorization-server endpoints and client records. Domain apps only *grant* resource access to principals that already exist.

Good app candidates: domain features, tools, reporting — anything where swapping the app out would not change how users log in or what roles mean.

## Schema isolation

Most apps own one Postgres schema and create it in their own `migrate.ts`: `contacts`, `grids`, `mail`, `notebooks`, `spaces`, `pulse`, `venue`, `faq`, `oauth`, `tools`, `dashboard`, `ipa_hosts`, `proxy_auth`, and `gateway` (owned by `gateway-ops`).

Platform schemas — `auth`, `logging`, `settings`, `notifications`, `audit` — belong to core migrations.

Not every app needs a schema. `files`, `weather`, `quotes`, `assistant`, `accounts`, `api-docs`, and `ui-lab` own none: they proxy an external service, read platform tables, or hold no persistent state at all. Do not create a schema an app does not need.

## Replaceable surfaces

Apps do not own the Cloud root route. Core serves `/` and redirects it to the operator-configured `app.home_path` setting, whose default is `/app/dashboard`. A replacement landing app needs only its own normal registered route plus a change to that setting — no core code change.

Likewise, app-specific admin groups are contributed through registry metadata (`adminHref`, `adminNav`) rather than being hardcoded in Core or Gateway.

## Universal search

Apps opt into platform-wide search by implementing `capabilities.search` in `app.start()`. The gateway aggregates results from every registered provider.

Universal Search runs for **browser sessions only** — Core rejects any service-account actor before provider fanout, user-delegated ones included. A provider receives `user` but never the acting credential, so it cannot cap by credential scope; restricting it to real sessions is what keeps a scoped API key from reading through search what it is denied everywhere else. A provider may therefore assume `ctx.get("user")` is present, and must not add service-account behaviour.

## You do not have to use the built-in stack

The stack — Bun, Hono, SolidJS, Postgres, Redis — exists because the shared helpers are TypeScript, and using it gets you auth, UI, settings, search, and admin surfaces for free.

But the actual contract with the platform is narrow: speak Postgres, register in the Redis app registry, and serve HTTP on your declared prefixes. An app in any language that does those three things is a first-class citizen of the gateway.

## Background work

Most app background work belongs in the app's own `lifecycle.start()` / `lifecycle.stop()` hooks, using `@valentinkolb/sync` primitives for coordination.

Reach for a separate worker package only when the work is high-volume, latency-sensitive, or must scale independently from the HTTP app. `gateway-ops` is the canonical shape: the hot path publishes to a Redis-backed topic and returns; batching, persistence, rollups, cleanup, and retries happen elsewhere.

Worker conventions:

- Give the worker its own compose service rather than overloading the HTTP app with mode env vars.
- Do not register workers in the app registry unless they serve HTTP. Workers are operational containers, not routable apps.
- Prefer `topic` for high-volume event streams, `job`/`scheduler` for bounded and periodic work, and `queue` for durable discrete work items.
