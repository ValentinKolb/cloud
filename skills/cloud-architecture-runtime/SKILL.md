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

- Runtime factory: `cloud/packages/core/src/cloud.ts`
- Runtime app meta context: `cloud/packages/core/src/runtime.ts` (`createRuntimeContext`, `getRuntimeContext`)
- Runtime engine (setup/start/stop/shutdown): `cloud/packages/core/src/runtime.ts` (`runSetupPhase`, `bootRuntime`)
- Standalone startup options (`--skip-setup`, `SKIP_SETUP`):
  `cloud/packages/standalone/src/runtime-options.ts`

## Notebooks Realtime Pattern (Yjs)

Use this when touching notebooks collaboration or websocket internals.

1. Keep websocket nodes stateless (no shared server Y.Doc manager).
2. Use `notes.yjs.replay.request` -> `notes.yjs.replay.ready` before client local state resend.
3. Publish realtime edits/events through topic stream only:
   - `sync` and `awareness` from clients
   - `reset` only from server restore flow
4. Mark snapshot dirty state from `sync` events only.
5. Persist snapshots asynchronously through queue worker + per-note mutex + DB stale-write guard.

Key files:
- `cloud/packages/apps/src/notebooks/ws.ts`
- `cloud/packages/apps/src/notebooks/service/yjs-sync.ts`
- `cloud/packages/apps/src/notebooks/service/yjs-snapshot-worker.ts`
- `cloud/packages/apps/src/notebooks/service/notes.ts`
- `cloud/packages/lib/src/browser/yjs/provider.ts`

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
