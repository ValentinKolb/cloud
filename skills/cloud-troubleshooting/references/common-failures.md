# Common Failures and Fast Checks

## Browser Bundle Imports Bun/Server Code

Symptoms:

- "Browser build cannot import Bun builtin" (`sql`, `redis`, `bun`).

Checks:

1. Inspect island imports for server-only modules.
2. Verify imports are from `@valentinkolb/cloud/lib/*` in browser code.
3. Ensure no app island imports core/server internals.

## API 500 After SQL Refactor

Symptoms:

- `UNION types ... cannot be matched`
- `SELECT DISTINCT ... ORDER BY expressions must appear in select list`

Checks:

1. Align column types across union branches with explicit casts.
2. Ensure DISTINCT projection contains ORDER BY expressions.
3. Keep count query and list query filter logic aligned.
4. Check that joins used by filter/search are identical in count/list queries.

## Rate Limit Unexpected 429

Checks:

1. Verify route-level rateLimit mounting and overrides.
2. Check global setting `security.rate_limit_per_second`.
3. Validate auth-vs-ip keying behavior for current request context.

## Hybrid Detail Panel State Drift

Symptoms:

- Selection lost, back/forward mismatch, scroll jumps.

Checks:

1. URL param remains source of truth.
2. replaceState/update event dispatched on selection.
3. popstate handler restores selected entity from available list.

## Query Param Drift (UI Does Not Match URL)

Symptoms:

- Toggle/filter appears active but URL missing key.
- Reload loses active filters unexpectedly.

Checks:

1. Confirm parse helper and URL builder use same key names/defaults.
2. Confirm non-default-only URL policy is applied consistently.
3. Confirm pagination links preserve active query params.

## Startup/Shutdown Lifecycle Problems

Checks:

1. Setup hooks run in deterministic order.
2. `--skip-setup`/`SKIP_SETUP` behavior matches expectation.
3. Stop hooks run reverse order and clear background intervals.
