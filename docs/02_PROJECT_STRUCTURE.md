# Project Structure

## Repository Layout

- `cloud/packages/core`: runtime composition and lifecycle.
- `cloud/packages/lib`: shared library package with frontend/browser exports and server builder APIs under `src/server`.
- `cloud/packages/contracts`: shared contracts and types.
- `cloud/packages/apps`: built-in apps and app registry.
- `cloud/packages/standalone`: standalone runtime entrypoint.
- `cloud/skills`: detailed coding patterns and operational knowledge for agents.
- `cloud/docs`: compact human docs.

## Dependency Direction

Keep imports flowing in one direction:

- apps consume public APIs from `lib`, `core`, and `contracts`.
- runtime (`core`) composes apps and core routes.
- no deep cross-package `src/*` imports.

## Package Roles

- `core`: start/stop/setup orchestration (`createCloud`), mounting API/pages/ws.
- `lib`: reusable frontend/browser primitives and server builder APIs, split by public subpaths:
  - `@valentinkolb/cloud-lib/ui`
  - `@valentinkolb/cloud-lib/islands`
  - `@valentinkolb/cloud-lib/browser`
  - `@valentinkolb/cloud-lib/shared`
  - `@valentinkolb/cloud-lib/server`
- `contracts`: shared type system and schemas.
- `apps`: concrete app features.
- `standalone`: product-mode bootstrap with built-ins.
