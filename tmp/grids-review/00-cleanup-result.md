# Grids App — Post-Review Cleanup, Result

This document closes out the cleanup that started from `tmp/grids-review/00-summary.md`. It records what landed, what didn't, and what the next person should pick up.

## Stats

- **Commits:** 21 (between `pre-review-cleanup` tag and HEAD).
- **LOC delta:** `+3200 / −1276` across 50 files in `packages/grids/` and `packages/cloud/src/services/`.
- **Tests:** 468 pass, 0 fail. All 21 packages typecheck clean.

The +1.9k net positive misses the parent task's "net negative" expectation — but the bulk lives in genuine new safety: `service/field-storage.ts` (+349, descriptor module that's now the source of truth for typed projections), `migrate.ts` (+177, slug backfill + NOT NULL + CHECK), `service/permission-resolver.ts` (+90, principal-tier + dashboard target), test files (+200), `service/records.ts` (transactional create/update + cursor-alias plumbing). Defensible.

## What landed by wave

### Wave 1 — Invariants (3 subtasks, all closed)
- **1.1** Slug invariant fully enforced. NOT NULL + CHECK regex; service insertWithSlug helper trusts the partial unique index instead of check-then-insert; mappers no longer coerce missing slug to empty string.
- **1.2** Parent-liveness consistency. Every non-trash `get*` / `list*` joins live parents; `record.get` adds `r.deleted_at IS NULL`; `record.restore` precondition-fails when parent is trashed.
- **1.3** Atomic record + relation writes. `record.create` and `record.update` wrap row INSERT/UPDATE + `writeRecordLinks` + `logAudit` in one `sql.begin`. `bases.create` rolls back the base on creator-grant failure.

### Wave 2 — Permissions (4 subtasks, all closed)
- **2.1** Canonical resolver with principal-tier + deny-overrides. Dashboard target wired through the resolver. Tests +9.
- **2.2** Direct GET visibility parity. View / dashboard direct GET gate at the resource scope; explicit `none` grants now hide. Personal resources visible to non-owners only via explicit grant.
- **2.3** PATCH share-transition gate. Personal→shared on view requires base-admin; dashboard write always requires base-admin (locked product rule).
- **2.4** Audit cross-table read leak. `audit.listByRecord(tableId, recordId, limit)` requires both ids.
- **Bonus:** Wave 2 codex review caught dashboard CREATE still using the old gate; fixed in commit 66d3897.

### Wave 3 — Frontend correctness (3 subtasks, all closed)
- **3.1** URL = SSR single source of truth. `parseRecordsState` is the only URL parser; SSR-side hand parsing deleted. RecordsState.query narrowed so `parse(build(s)) === s` actually holds. `recordsStatesEqual` deleted.
- **3.2** Saved view query merged with URL state. `effective-query.ts` exports `resolveEffectiveQuery(state, view)`. Visibility-aware view resolution: `getByIdOrSlug` result only adopts as `activeView` when ACL-filtered `viewsForTable` surfaces it.
- **3.3** Dashboard editor focus loss. Outer `<For each={rows}>` and inner `<For each={cells}>` switched to `<Index>`; kind-discriminated render via inline `<Show>` blocks.

### Wave 4 — Compiler & formula correctness (6 subtasks, all closed)
- **4.1** Storage descriptors. New `service/field-storage.ts` is the typed-SQL-projection source of truth. Currency / decimal / date / boolean / select / numeric subtypes all declare their projection once. Aggregate-compiler and computed-projections now read it (rollup currency bug closed). Sort-compiler uses the descriptor's sortability flag — unsortable types compile-error cleanly.
- **4.2** Sort cursor round-trips from SQL aliases. `cursorSelect` fragment + `encodeCursorFromRow` on the compiled-sort result. Cursor decode validates UUID + length. Corrupt JSONB no longer crashes page 2.
- **4.3** Relation aggregates rejected; multi-select empty/notEmpty guarded with `jsonb_typeof`; granularity on non-date groupBy compile-errors; duplicate aggregate requests compile-error.
- **4.4** Filter / cursor / lookup / export query-param validation. `validatePredicateValue` per op (boolean, lastNDays int, ISO dates, numeric, select). `parseJsonbRow` no longer parses bare-literal strings (`"42"` stays `"42"`). `/lookup` and `/export` Zod-validated.
- **4.5** Formula error propagation + cycle. Two-pass evaluation (scratch overlay) so downstream formulas see `FormulaError` sentinels not rendered strings. DFS marks every stack member from re-entry. AND/OR short-circuit. Number tokenizer rejects malformed inputs.
- **4.6** Field dependency tracking. Reads `views.query` (was dropped `v.config`). Cross-table candidate scan. Formula refs via parser (`#slug` works alongside `{uuid}`).

### Wave 5 — Field-type & rendering (1 of 4 subtasks closed; 3 deferred)
- **5.2** Same-base relations + config invariants. `validateLinkOrComputedConfig` runs DB-context checks for relation/lookup/rollup before save. Cross-field invariants via `z.superRefine` for decimal (scale ≤ precision), number (min ≤ max), date (min ≤ max), multi-select (minSelected ≤ maxSelected ≤ options.length).
- **5.1, 5.3, 5.4 — DEFERRED.** See "Open items" below.

### Wave 6 — Deletions & consolidation (2 of 4 subtasks closed)
- **6.1** Old records query routes deleted (`GET /by-table/:id`, `POST /aggregate/:id`, `POST /group/:id`). `POST /tables/:id/query` is the one query API. Net delete ~88 LOC.
- **6.3** Small dead-code + stale-comment cleanup. "Two row types, period" comment → three; empty cursor `if`-block in group-compiler removed; unused `requireBaseAlive` deleted; `parseJsonbRow` semantics + slug-column docs updated.
- **6.4** Final codex review + this document.
- **6.2 — DEFERRED.** Editor draft helper + permission editor wrapper.

### Post-final-review fixes (commit b2bedc1)
The final codex review caught three real issues, all closed:
1. **Cross-table rollup regression.** Wave 4.1's storage-descriptor migration in computed-projections used the source-table fields map to resolve rollup targets, but rollup targets live on different tables. Made `buildComputedProjections` async with cross-table fallback fetch.
2. **Critical #4 was only partial.** SSR painted view-filtered rows, but the island's `initialState` carried URL-only `parsedFilter`/`parsedSort`. First refetch reverted to unfiltered. Lifted effectiveFilter/Sort/etc to outer scope; island now seeds from the effective query.
3. **Saved-view field cleanup on delete (Critical #11).** field-dependents reports views as non-blocking, but the cleanup only stripped form refs. Added `cleanupViewFieldRefs` that walks the view query JSONB and removes the deleted field from filter / sort / groupBy / aggregations / columns.

## Critical findings status (from `00-summary.md`)

| # | Title | Status | Key file |
|---|---|---|---|
| 1 | Audit log cross-table read leak | ✅ closed | `service/audit.ts:95` |
| 2 | Personal view → shared without admin | ✅ closed | `api/views.ts` |
| 3 | Personal dashboard → shared without admin | ✅ closed | `api/dashboards.ts` |
| 4 | Saved-view URLs render unfiltered rows | ✅ closed (after final-review fix) | `frontend/[baseId]/page.tsx` |
| 5 | Relation config can cross base boundaries | ✅ closed | `service/fields.ts:validateLinkOrComputedConfig` |
| 6 | Dashboard editor remounts row on keystroke | ✅ closed | `DashboardEditPage.island.tsx` |
| 7 | Field input rendering forks | ⏸ DEFERRED | Wave 5.3 |
| 8 | Sort cursor doesn't round-trip SQL value | ✅ closed | `service/sort-compiler.ts` |
| 9 | Relation count aggregate reads obsolete JSONB | ✅ closed (rejection) | `service/aggregate-compiler.ts:57` |
| 10 | Field-dependents reads dropped column | ✅ closed | `service/field-dependents.ts` |
| 11 | Saved view dependents detected but never cleaned | ✅ closed (after final-review fix) | `service/fields.ts:cleanupViewFieldRefs` |
| 12 | Dependent formulas lose upstream errors | ✅ closed | `service/relations.ts` |
| 13 | Cycle detection misses interior nodes | ✅ closed | `service/relations.ts` |
| 14 | Permission resolver doesn't honor `none` | ✅ closed | `service/permission-resolver.ts` |
| 15 | Deleted parents don't hide children | ✅ closed | `service/{tables,fields,records}.ts` JOINs |
| 16 | Record + relation writes not atomic | ✅ closed | `service/records.ts:create+update` |
| 17 | Invalid configs persisted | ✅ closed | `field-types/*.ts` superRefine + `service/fields.ts` |

**16 of 17 Critical closed. 1 deferred (Wave 5.3 — field-rendering registry).**

## Open items (logged for follow-up)

Ranked by user impact, top-first.

### High impact

1. **Wave 5.3 — one field-rendering registry.** Critical #7. Currency renders as plain `NumberInput` in `FieldInput` (loses currency code), as freeform `TagsInput` for multi-select in `CreateRecordDialog` (accepts unknown option ids → server rejects). Forks across `form-fields.tsx`, `CreateRecordDialog.tsx`, `field-prompt-schema.ts`, `RecordDetailPanel.tsx`. The fix is one `FIELD_RENDERERS` registry; ~6 hours of frontend refactor.
2. **Sidebar view links serialize view query into URL.** Result: a stale bookmark or shared link can override fresh view-edits. Codex flagged at `frontend/[baseId]/page.tsx:773`. Should change to clean `?table=X&view=Y` only — the page resolves the view-query SSR-side. Cosmetic-ish but visibly stale data.

### Medium impact

3. **`group-compiler` not migrated to storage descriptor (Wave 4.1 partial).** The compiler still re-spells currency / numeric projection rules at `group-compiler.ts:214,270`. Closes the centralization; one focused refactor.
4. **Wave 6.2 — editor draft helper + permission editor wrapper.** ViewEditPage column auto-save races itself; four save/dirty patterns across editors. Permission editor wiring duplicated 5 ways. KISS deletion of ~150 LOC.
5. **`buildRelationLabelCache` / `resolveLabelsByTargetTable` / `buildLabelCacheForGroupedKeys` collapse.** Three close cousins; codex spotted that the first overwrites labels when two relation fields target the same table with different `displayFieldId`. Settling whether `displayFieldId` should exist (currently aspirational, partly unsupported) closes the bug.

### Lower impact

6. **Wave 5.1 / 5.4 — split scalar/computed/link kinds + text-preset collapse.** KISS-only restructurings. No bugs blocked. Worth doing eventually for readability and to remove ~200 LOC of fake `validate: () => fail(...)` stubs and tier2/tier3 catch-all files.
7. **Default value normalization on save.** Currency `"12.34 EUR"` stored as raw string while records store `{amount, currency}`; decimal `"10"` not normalized to fixed-scale `"10.00"`. Surfaces as a UX inconsistency when reading defaults back through the renderer.
8. **Lookup `targetField` storage-descriptor adoption.** Currently lookup uses `data->>targetFieldId` (text fallback) regardless of target type. Same-class as the rollup currency bug, smaller blast radius (lookup is display-only).
9. **Smaller formula items.** Decimal precision in functions (ROUND/ABS), numeric-string equality coercion, save-time AST validation (unknown function, bad arity, unknown field reference), DATEADD sub-day units. Each ~30 minutes; aggregate to a "formula ergonomics" follow-up.
10. **Migration backfill advisory lock.** Concurrent app-process boots can race the slug backfill — low probability with random slugs, but easy to make deterministic. One advisory-lock wrapper around `migrate()`.

## What's now safe to ship to alpha-beta users

- **Permissions** are materially better. Deny-overrides honored; direct GET respects view/dashboard scope; audit no longer leaks across tables; share-transition gates prevent privilege escalation.
- **Data integrity** — record + relation writes atomic; cross-base relation config rejected; impossible field configs rejected at save; saved views auto-clean on field delete; sort cursors don't crash on corrupt JSONB.
- **Saved views** render correctly end-to-end (SSR and refetch consistency).

## What still has rough edges

- **Frontend record-editing rendering forks** (Critical #7). Ship-blocking only if users hit the currency / multi-select inconsistencies; the row-mode grid renders correctly via the relation-cell path that was fixed earlier.
- **No real product decision yet on the relation `displayFieldId` field.** Treated as half-supported; visible UI is half-wired.
- **Some compilers still hold their own typed-projection logic** (group-compiler). Not user-visible until someone adds a currency groupBy column.

## Recommended next session

If you have one focused day: **Wave 5.3** (field-rendering registry). Closes the last Critical. Same shape as the storage descriptor we landed for the SQL side — one source of truth per concern.

If you have a half day: clean up the sidebar view-link serialization (item 2 above) and migrate group-compiler to the storage descriptor (item 3). Both small, both cumulative wins.

## Caveman TLDR

🪨 **CAVEMAN UPDATE: TRIBE PRACTICE WAS GOOD.**

Took **17 ugh bugs**, killed **16**. Last one (currency input look different on different screens) too big for one fight, save for next moon.

Code now honest: cave wall (data) match contract. Spirits (permissions) deny when shaman say deny. Rocks (records) and chains (relations) tied with same string — break together or hold together. Saved view URLs work like saved view say. Cursor not eat raw mud (corrupt JSONB).

Tribe wrote down all decisions in stone tablets (commits, dex tasks, this scroll). Next caveman read scroll, fix last bug, drink mead.

🪨 **READY FOR BETA SCOUT, NOT YET FOR FULL TRIBE.**
