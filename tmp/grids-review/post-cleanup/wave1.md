# Wave 1 (Invariants) — Post-Cleanup Review

**Commits reviewed:** 15d3534, 1562b71, 6e62a26
**Files changed:** ~12

## Verdict
Wave 1 closes the slug create race and makes record-row + relation-link writes genuinely atomic. Slug persistence is also much stronger: contracts, mappers, backfill, `NOT NULL`, and DB format checks now agree. Parent-liveness is improved but only partially closed at the service boundary: entity `get/list` paths mostly join live parents, but record list/group/aggregate still query by `table_id` without a live table/base join, so a direct service caller can still read records under a deleted parent.

## Closed findings
- **Slug invariants are not actually enforced — closed.** `SlugSchema` now requires 5 alphanumeric chars (`packages/grids/src/contracts.ts:18`) and base/table/field/view/dashboard schemas use it (`packages/grids/src/contracts.ts:21`, `packages/grids/src/contracts.ts:55`, `packages/grids/src/contracts.ts:81`, `packages/grids/src/contracts.ts:664`). Migration backfills all slug-bearing rows, including trashed rows (`packages/grids/src/migrate.ts:529`, `packages/grids/src/migrate.ts:542`, `packages/grids/src/migrate.ts:560`, `packages/grids/src/migrate.ts:578`, `packages/grids/src/migrate.ts:596`, `packages/grids/src/migrate.ts:614`), then applies `ALTER COLUMN slug SET NOT NULL` plus a regex check (`packages/grids/src/migrate.ts:635`). Mappers also stopped coercing missing slugs to `""` (`packages/grids/src/service/forms.ts:120`, `packages/grids/src/service/views.ts:23`, `packages/grids/src/service/dashboards.ts:38`).
- **Deleted parents do not hide child resources consistently — partial.** Fixed for many direct entity reads: tables join live bases (`packages/grids/src/service/tables.ts:80`), fields/forms/views join live table+base (`packages/grids/src/service/fields.ts:57`, `packages/grids/src/service/forms.ts:214`, `packages/grids/src/service/views.ts:146`), dashboards join live bases (`packages/grids/src/service/dashboards.ts:93`), and `record.get` now joins live table+base and filters `r.deleted_at IS NULL` (`packages/grids/src/service/records.ts:401`). Still not a complete service invariant: `record.list` builds `WHERE table_id = ...` with no parent join (`packages/grids/src/service/records.ts:220`), `aggregate` does the same (`packages/grids/src/service/records.ts:377`), and group queries compile from `grids.records r` with only `r.table_id = ...` (`packages/grids/src/service/group-compiler.ts:376`, `packages/grids/src/service/group-compiler.ts:386`). `field.restore` also bypasses the new parent checks with a raw `SELECT * FROM grids.fields WHERE id = ...` (`packages/grids/src/service/fields.ts:373`).
- **Relation writes are not atomic with record writes — closed.** `record.create` wraps record insert, link writes, and audit in one `sql.begin` (`packages/grids/src/service/records.ts:467`); `record.update` wraps the versioned row update, link writes, and audit in one transaction (`packages/grids/src/service/records.ts:569`). `writeRecordLinks` now accepts the caller's transaction client and only opens its own transaction when called standalone (`packages/grids/src/service/relations.ts:62`).
- **Slug check-then-insert race — closed for create paths.** The old `generateUniqueSlug(check)` helpers are gone; create paths call `insertWithSlug` (`packages/grids/src/service/bases.ts:97`, `packages/grids/src/service/tables.ts:128`, `packages/grids/src/service/fields.ts:150`, `packages/grids/src/service/forms.ts:324`, `packages/grids/src/service/views.ts:241`, `packages/grids/src/service/dashboards.ts:219`). `insertWithSlug` retries only on the named slug unique index (`packages/grids/src/service/slug.ts:39`), so the DB index is now authoritative.

## New findings (introduced by Wave 1)
### Critical
none.

### Important
none introduced. The remaining parent-liveness gaps above are incomplete cleanup of the original finding, not a new regression.

### Minor
- **Stale migration comments** — `packages/grids/src/migrate.ts:393` still says slug columns are NULL-tolerant and service-enforced, but the same migration later enforces `NOT NULL`/`CHECK`. Update the comment so future cleanup does not preserve the old mental model.

## KISS / overengineering check
The main implementation is KISS enough: `insertWithSlug` is smaller and more correct than one `slugTaken*` helper per service, and passing an optional SQL client into `writeRecordLinks` is the least invasive way to get transaction composition. The parent-liveness helper file is slightly ahead of usage: `requireBaseAlive` is currently unused (`packages/grids/src/service/parent-checks.ts:22`), while most callers inline joins. Either use it in base-scoped restore/create paths or delete it until needed.

Some comments are doing too much explanatory work for alpha code, especially the migration slug backfill and record relation preflight sections. The behavior is simple enough that a few comments could be cut once Wave 1 settles.

## Open follow-ups noticed during review
- Finish parent-liveness at the service layer by adding live table/base joins to `record.list`, `record.aggregate`, and `compileGroupQuery`, or by making those helpers require a prior `table.get` result instead of a raw table id.
- Make `field.restore` use `get(id)`/`requireTableAlive` like the other restore paths.
- Decide slug reuse semantics for trashed rows. Backfill avoids trashed collisions, but create paths rely on partial live unique indexes, so a rare random collision with a trashed row is still possible and would fail later restore.
- The migration backfill is still check-then-update without an advisory lock. Low probability with random slugs, but concurrent boot can still be made deterministic with a migration lock if multiple app instances run migrations.
