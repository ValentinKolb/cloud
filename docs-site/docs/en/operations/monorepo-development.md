---
title: Monorepo development
navTitle: Monorepo development
section: Operations
order: 1110
description: Develop a built-in application inside the Cloud monorepo.
tags: [development, monorepo, docker]
updated: 2026-07-27
---

# Monorepo development

Use the monorepo when you change the platform or a built-in application.

Docker Compose runs infrastructure and application services. Source folders are
mounted into the containers and Bun watches for changes.

## Start the core stack

```bash
bun install
bun run infra
bun run dev
```

Open `http://localhost:3000`.

The local administrator login is `/auth/login?method=admin` with token
`dev-admin`.

`bun run dev` stays in the foreground and runs the gateway, Gateway Ops, Core,
Dashboard, Accounts, and Assistant.

Use `bun run dev:full` only when you need every optional application.

## Work on one application

```bash
bun run dev:start grids
bun run dev:logs grids
bun run dev:status grids
```

| Command | Result |
| --- | --- |
| `dev:start <app...>` | Starts existing images |
| `dev:stop <app...>` | Stops containers without removing them |
| `dev:rebuild <app...>` | Rebuilds and restarts applications |
| `dev:logs <app>` | Follows one application log |
| `dev:status [app]` | Shows stack or application status |
| `dev:help` | Lists commands and application names |
| `dev:down` | Removes the development stack |

Rebuild after dependency, package-manifest, or Dockerfile changes. Source edits
normally use the watch process already running in the container.

## Use one Compose network

The development files use the implicit Compose project name. In the standard
checkout, that name is `cloud`.

Applications resolve infrastructure by container name. Changing the Compose
project name or passing a different `-p` value can put services on different
networks.

Only the gateway publishes a host port. Do not publish each application.

## Add a built-in application

Add the package to the workspace and give it a development service in
`compose.dev.yml`.

The service needs:

- the shared environment;
- `APP_ID`;
- the Cloud source and script mounts;
- its own source mount;
- the shared stylesheet;
- the Cloud preload script and Bun watch command.

Add the package manifest to `Dockerfile.dev` so dependency installation remains
cacheable.

An HTTP application registers itself at startup. The gateway discovers it from
the shared registry.

A worker without HTTP routes should be a separate service. It should not
register application routes.

## Run checks

```bash
bun run typecheck
bun run test
```

The root test command runs every workspace in a separate process. It uses each
package's `test` script when one exists, preserving package-specific builds,
environment variables, browser conditions, and preloads. Workspaces without a
test script and root-owned tests still run in isolated Bun test processes.

For a focused package:

```bash
bun run --filter @valentinkolb/cloud-app-grids typecheck
bun test packages/grids
```

The root typecheck also verifies import boundaries, package cycles, service API
contracts, shared UI coverage, CSS architecture, and formatting.

See [Frontend testing](/en/docs/frontend/testing) for browser-facing checks.
