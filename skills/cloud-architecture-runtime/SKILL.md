---
name: cloud-architecture-runtime
description: Use when changing package boundaries, runtime composition, app registration, lifecycle startup/shutdown behavior, or workspace-level architecture in the cloud monorepo.
---
# Cloud Architecture Runtime

Use this skill for runtime wiring, package boundaries, and lifecycle orchestration.

## When To Use

- Moving code between `core/server/contracts/client` packages.
- Changing cloud startup/setup/shutdown behavior.
- Adjusting app registry composition or route mounting.
- Enforcing import boundaries and cycle prevention.

## Quick Lookup (Do Not Guess)

- Runtime factory: `cloud/packages/core/src/core/cloud/index.ts`
- Runtime app meta context: `cloud/packages/core/src/core/runtime/apps.ts`
- Runtime engine (setup/start/stop/shutdown): `cloud/packages/core/src/core/runtime/engine.ts`
- Standalone startup options (`--skip-setup`, `SKIP_SETUP`):
  `cloud/packages/standalone/src/runtime-options.ts`

## Hard Rules

1. Keep `@valentinkolb/cloud-core` runtime-only.
2. Keep app code on public package surfaces only.
3. No package cycles.
4. Preserve route parity unless explicitly requested.
5. Keep zero-DB-change unless explicitly requested.

## Practical Patterns

- Deterministic app order for mount/start/stop.
- Setup hard-fails startup on migration/init errors.
- Stop hooks run reverse order and continue after per-app errors.
- CLI/env startup switches are parsed once and applied centrally.

## References

- Runtime map and lifecycle order: `references/runtime-map.md`

## Reference Routing

- Read `references/runtime-map.md` before moving code between packages or changing lifecycle order.
