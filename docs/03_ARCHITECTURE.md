# Architecture

## Runtime Model

Runtime composition is centralized in `cloud/packages/core/src/core/cloud/index.ts`.

`createCloud({ apps, coreOptions })`:

1. validates + registers app facades
2. composes API/pages/ws routers
3. runs setup phase (core + app lifecycle setup)
4. loads settings cache
5. starts app lifecycle and core background services
6. installs graceful shutdown (`SIGTERM`/`SIGINT`)

## App Contract

Apps follow `AppFacade` from `cloud/packages/contracts/src/shared/app.ts`:

- `meta`: identity, nav, admin link, display information
- `service`: stateless business logic entry
- `routes`: optional `api`, `pages`, `ws`
- `widgets`: optional home widgets
- `lifecycle`: optional `setup/start/stop`

Built-in apps are statically ordered in `cloud/packages/standalone/src/built-in-apps.ts`.

## Routing

- API routes mount under `/api`.
- Page routes mount under `/`.
- Websocket routes mount under `/ws`.

Each app owns absolute app-local paths (for example `/app/files`).

## Setup and Shutdown

- setup order: core migrations, then app setup hooks
- start order: app start hooks, then core background services
- stop order: app stop hooks in reverse order, then core stop hooks

Setup can be skipped with `--skip-setup` or `SKIP_SETUP=true`.
