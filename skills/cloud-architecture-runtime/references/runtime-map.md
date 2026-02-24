# Runtime Map

## Package Roles

- `@valentinkolb/cloud-core`: runtime orchestration, app composition, lifecycle wiring.
- `@valentinkolb/cloud-lib/server`: middleware, server services, response helpers.
- `@valentinkolb/cloud-contracts`: shared types/schemas/contracts.
- `@valentinkolb/cloud-lib`: shared UI, islands, browser utils, styles.
- `@valentinkolb/cloud-apps`: built-in apps (same facade contract as custom apps).
- `@valentinkolb/cloud-standalone`: standalone entry that ships built-ins.

## Runtime Wiring Sources

- Create cloud runtime: `cloud/packages/core/src/core/cloud/index.ts`
- API composition: `cloud/packages/core/src/core/api/index.ts`
- Page composition: `cloud/packages/core/src/core/pages/create.tsx`
- Runtime app meta context: `cloud/packages/core/src/core/runtime/apps.ts`
- Runtime engine (setup/start/stop/shutdown): `cloud/packages/core/src/core/runtime/engine.ts`
- Standalone startup option parsing: `cloud/packages/standalone/src/runtime-options.ts`

## Lifecycle Order

1. Parse startup options (`--skip-setup`, `SKIP_SETUP`).
2. Run core setup.
3. Run app setup hooks in app order.
4. Load settings cache.
5. Run app start hooks in app order.
6. Start core background services.
7. Install shutdown signal handlers.
8. On stop: app stop hooks reverse order, then core stop services.

## Boundary Invariants

- No cross-package deep imports.
- No package cycles.
- App list order is deterministic and reused for nav/admin/widgets/startup.
- Request context exposes `runtime.apps` (meta only) for page/API handlers.
- Runtime setup errors are startup blockers.
