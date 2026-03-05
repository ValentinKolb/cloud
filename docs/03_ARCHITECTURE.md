# Architecture

## Runtime Model

Runtime composition is centralized in `cloud/packages/core/src/cloud.ts`.

`createCloud({ apps, coreOptions })`:

1. validates + registers app facades
2. composes API/pages/ws routers
3. runs setup phase (core + app lifecycle setup)
4. loads settings cache
5. starts app lifecycle and core background services
6. installs graceful shutdown (`SIGTERM`/`SIGINT`)

## App Contract

Apps follow `AppFacade` from `cloud/packages/contracts/src/app.ts`:

- `meta`: identity, nav, admin link, display information
- `service`: stateless business logic entry
- `routes`: optional `api`, `pages`, `ws`
- `widgets`: optional home widgets
- `lifecycle`: optional `setup/start/stop`
- `capabilities`: optional cross-app capabilities (for example `search.run({ query, tags, limit, ctx })`)

## Global Search

Core exposes authenticated global search at:

- `GET /api/search?q=<query>&tag=<tag>&provider_limit=<1..99>`

Behavior:

1. core discovers providers via `app.capabilities?.search`
2. calls all providers in parallel with `{ query, tags, limit: provider_limit, ctx }`
3. provider tags are optional and defined at `app.capabilities.search.tags`
4. runtime mirrors tags into `runtime.apps[].searchTags` for frontend help rendering
5. validates provider items (`priority` is integer `0..9`)
6. supports optional provider metadata (`metadata: Array<{label,value}>`) and optional image preview paths (`previewUrl`)
7. fail-open on provider errors (warn log + partial results)
8. sorts by priority desc, then title asc

The API does not apply a global result limit; frontend decides final display cap.

## Spotlight Frontend

Global search is consumed by a spotlight-style dialog opened with `mod+k`.

UI behavior:

1. desktop (`md+`): two columns (results + preview/details)
2. mobile (`<md`): results list only
3. users can narrow results via `#tags` in the query (for example `#file report`)
4. fixed top anchor: spotlight stays at a stable top position and only expands downward
5. results panel uses CSS-only expand/collapse transitions (no JS animation layer)

Built-in apps are statically ordered in `cloud/packages/standalone/src/built-in-apps.ts`.

## Routing

- API routes mount under `/api`.
- Page routes mount under `/`.
- Websocket routes mount under `/ws`.

Each app owns absolute app-local paths (for example `/app/files`).

For notebooks realtime/Yjs internals, see:

- `cloud/docs/10_NOTEBOOKS_YJS_REALTIME.md`

## Setup and Shutdown

- setup order: core migrations, then app setup hooks
- start order: app start hooks, then core background services
- stop order: app stop hooks in reverse order, then core stop hooks

Setup can be skipped with `--skip-setup` or `SKIP_SETUP=true`.
