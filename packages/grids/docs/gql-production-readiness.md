# GQL Production-Readiness Analysis

## Current status snapshot — 2026-07-09

This file is both a current release-status note and the historical hardening
log for GQL. Read this section first. The chronological batches below are kept
as evidence, but old "open" items in historical sections are not automatically
current release blockers.

### Current backend posture

GQL is the canonical read/query layer for Grids tables, views, dashboard data
sources, document-template data sources, CLI queries, and assistant context.
The public API route is `/gql`; the legacy `/query-dsl` API alias is removed.
Views persist canonical GQL source text and UI-only presentation settings
separately. Dashboard widgets consume saved-view/GQL data through the same
parser, resolver, preview/runtime, statement-timeout, diagnostics, and
permission-gating path as the query explorer.

Current public syntax is intentionally narrow: typed `from table` / `from view`
sources, readable or quoted names, stable braced ids for generated output,
`asc` / `desc`, `offset`, `nulls first` / `nulls last`, direct `where` /
`having` expressions, lowercase predicate helpers, and explicit
`include deleted` / `deleted only`. Legacy GQL aliases such as `#field`, `skip`,
`ascending`, `descending`, `&&`, `||`, `!`, and `AND(...)` / `OR(...)` /
`NOT(...)` are rejected with replacement diagnostics.

Current verification without a live DB:

```bash
cd packages/grids && bun run typecheck
cd packages/grids && bun test
```

Latest local evidence from the review pass: `bun run typecheck` green and
`bun test` green with 969 pass / 71 skip / 0 fail / 4675 expect() calls.
DB-backed GQL tests are opt-in because they need Postgres:

```bash
cd packages/grids
GRIDS_QUERY_DSL_DB_TEST=1 bun test src/query-dsl/sql-compiler.integration.test.ts src/api/gql.integration.test.ts
```

Before release, run the DB-backed suite against a real Grids schema. The local
review session did not rerun those DB tests.

### Current GQL-specific open work

- **Runtime observability:** preview/execute paths should record
  privacy-safe duration, result shape, timeout/error class, base/source ids, and
  caller surface without persisting raw query text by default.
- **Large-module maintainability:** `query-dsl/resolver.ts`,
  `query-dsl/sql-compiler.ts`, `query-dsl/record-query-source.ts`,
  `service/formula-sql-compiler.ts`, and the oversized GQL regression suites
  should be split by responsibility. This is maintainability work, not a known
  semantic blocker.
- **Trusted render contexts:** document template and dashboard rendering use an
  explicitly named trusted GQL resolver context after the caller has passed the
  document-template or dashboard access gate. This intentionally lets the
  allowed resource render its saved GQL source without re-checking every parent
  table, while public GQL autocomplete/preview still uses the permission-shaped
  resolver context.
- **Stored formula legacy refs:** GQL rejects `#field`, but stored formula
  expressions still support legacy `#slug` and `{uuid}` refs for compatibility.
  Decide the long-term authoring/migration policy before calling formula
  syntax fully one-obvious-way.
- **Internal naming:** public routes and copy say GQL. The source directory is
  still `query-dsl/`. Rename only if the value outweighs churn across tests,
  imports, docs, and history.

### Historical log

The rest of this document records the hardening sequence that led to the
current state. It remains useful for why decisions were made, what was fixed,
and which tests proved each batch.

## Historical backend hardening posture — 2026-06-14

The GQL surface is now intentionally narrower and more publishable: one
canonical field-reference style, one offset spelling, one boolean-operator
style, and explicit preview-vs-save boundaries. The public DSL should read like
a small query language for Grids, not like a permissive SQL clone.

- **Canonical refs:** public GQL uses field/source names, quoted names, scoped
  refs (`customer.name`), or stable braced ids (`{fieldId}`). Legacy `#field`
  refs are rejected in GQL with a migration diagnostic. Formula-field storage
  expressions still support their legacy syntax for compatibility.
- **Explicit sources:** authored source clauses use `from table ...` or
  `from view ...`; untyped `from Orders` is rejected instead of guessing. The
  only implicit source is the API/workspace `currentSource`, which is
  canonicalized to a stable `from table {id}` or `from view {id}` before
  persistence.
- **Canonical clauses:** `offset` replaces `skip`; sort directions are `asc` /
  `desc`; `where`/`having` use direct formula syntax instead of
  `where formula(...)`; empty checks are `field = null` / `field != null`.
- **Canonical logic:** GQL predicates use `and` / `or` / `not` operators.
  `&&`, `||`, `!`, and logical function calls `AND(...)` / `OR(...)` /
  `NOT(...)` are rejected instead of guessed.
- **Canonical predicate helpers:** public predicate functions use lowercase
  spellings such as `oneof`, `noneof`, `contains`, `containsall`, `icontains`,
  `istartswith`, and `iendswith`. Removed aliases such as `ANYOF` and
  `CONTAINSANY` fail with replacement diagnostics instead of falling through to
  generic formula errors.
- **Scoped joins:** source aliases and self-joins are supported. Row joins,
  reverse joins, scoped sorting, scoped search, grouped relation joins, joined
  aggregates, grouped joined sorting, exploded joined relation/multi-select
  group keys, computed joined formula/lookup/rollup group keys, formula
  expressions and scoped text predicate helpers over joined scalar fields,
  joined lookup/rollup select/sort/formula output, formula aggregates over
  joined scalar fields, and direct aggregates over SQL-projectable
  formula/lookup/rollup values all compile to SQL-only preview plans.
- **Persistence boundary:** a single resolver builds the full query plan. Views
  persist canonical GQL source text in `grids.views.source`, and UI-only
  presentation state lives in `grids.views.ui`. Record-shaped table execution
  uses the internal `RecordQuery` model where that is the simplest runtime
  shape; richer GQL features keep their semantics in the resolved SQL plan
  instead of being downgraded.
- **Public API path:** the preview/compile/intelligence GQL API is exposed
  under `/gql`; the legacy `/query-dsl` route alias was removed before release.
- **View lifecycle:** views are first-class saved GQL artifacts: visible views
  appear in the Grids sidebar, direct links reload through the workspace route,
  and View settings expose the canonical GQL source plus UI presentation
  settings.
- **Derived saved-view sources:** grouped and aggregate saved views can be used
  as read-only derived GQL sources. Their output columns are queryable with
  `select`, `where`, `search`, `sort`, `group by`, `aggregate`, `having`,
  `limit`, and `offset`. Relation group-output columns can be joined explicitly
  to their target table record id (`join table Customers as customer on Customer
  = customer.id`), with joined fields selectable, sortable, searchable,
  filterable in formula `where`, groupable, and aggregatable in SQL.
  Search over a derived relation group-output column uses the visible target
  labels, not raw UUID text.
  Saved-view search/filter/sort/limit scopes are applied before derived
  regrouping or re-aggregation.
  Dashboard-widget consumption now uses the same GQL preview/runtime path.
- **Positioned diagnostics:** parser/resolver diagnostics and mapped preview
  compiler guardrails carry `line`/`column`/`length` where the source clause is
  unambiguous. Unknown internal compiler failures remain message-only instead
  of guessing a location.
- **Permission boundary:** relation preview labels and relation-field search are
  viewer-gated by target-table read access. A non-admin viewer without read on
  the target table receives neutral relation labels and no relation-search
  matches instead of linked record data.
- **Dashboard backend contract:** saved view GQL sources can be resolved for
  dashboard-style backend consumption through the same parser, resolver, preview
  compiler, statement timeout, diagnostics, and relation viewer-gating as normal
  GQL preview. The helper enforces view read/admin visibility, and dashboard
  widgets resolve saved view sources through this path instead of a second
  view-query/stat-source evaluator.
- **Canonical numeric outputs:** SQL-projected formula/computed numeric results
  are normalized through the same Decimal.js rendering used by the formula
  engine, so PostgreSQL scale artifacts such as `1.300` do not leak as a
  different API value than the JS fallback would render.

## Implemented 2026-06-12 — first-class `where`/`having` predicate layer

The `where` resolution was rewritten so **every field type is a first-class
filter citizen**, all compiled to SQL (no JS). Files: `query-dsl/resolver.ts`
(new `buildPredicate`/`resolveWhere` + `DslWherePredicate`), `query-dsl/sql-compiler.ts`
(`compileWherePredicate` + NULLS parity), `service/filter-compiler.ts` (new ops).

- **Select**: `status = 'Open'` resolves the label (or id) to the stored option
  id; unknown options error with the valid list. `oneof`/`noneof`/`containsall`
  for membership; `= null`/`isempty(...)` for emptiness. (Fixes A1.)
- **Relation**: `rel = <uuid>` → record-link containment; `!=` → `notContainsAny`;
  `oneof(rel, …)` → `containsAny`. Non-uuid literal gives a clear relation error.
- **Date**: full operator set `= != < <= > >=` → `=/notEquals/before/onOrBefore/after/onOrAfter`.
- **Boolean**: bare `where paid` means `= true`; `!= true` → `= false`.
- **Text**: `= != contains startswith endswith`.
- **Routing**: `field <op> literal` and the predicate functions → typed filter
  leaf (RecordQuery-compatible, index-friendly). Field-vs-field / arithmetic /
  scalar funcs → boolean SQL formula. Canonical logical spelling is
  `and`/`or`/`not`. Mixed
  filter+formula predicates compile to one SQL boolean; forms that do not fit
  the RecordQuery runtime still execute fully in SQL in preview.
- **NULLS parity** (A2): GQL preview sort now `NULLS LAST` for both directions,
  matching saved-view semantics.
- Tests: 21 new resolver cases + 3 new Postgres integration cases (relation
  containment, mixed predicate, NOT). Full grids suite green (695 pass), typecheck clean.

### Follow-up batch (same day)

- **A3 + B3 — preview correctness & DoS**: removed the silent 5k-row sampling for
  aggregate/grouped previews (numbers now equal the real numbers); every preview
  statement runs under a 5s `statement_timeout` (transaction `SET LOCAL`), with a
  friendly timeout diagnostic. `preview.ts`.
- **A5 / C4 — formula fields are first-class operands**: `formula-sql-compiler`
  now inlines a referenced formula field's own expression (cycle-detected,
  depth-capped 8). So `where margin > 0`, `sort margin`, `aggregate sum(margin)`,
  and nested formula fields all compile to SQL. Resolver routes computed/json
  fields in comparisons + predicate functions to the formula path.
- **A7 — consistency**: the grouped aggregate compiler now rejects duplicate
  `(field, agg)` like the flat aggregate compiler (was a silent drop).
- **A10 — explode surfaced**: grouped preview response carries `explode` when a
  group key is multi-select/relation (`contracts.ts` + `preview.ts`).
- **B1 — hardening**: central `assertSqlIdentifier` (`service/sql-ident.ts`)
  guards every dynamic `sql.unsafe` identifier site in the group compiler.

Tests: +7 (formula inlining/cycle/blank, formula-field filter) + 3 integration.
Full grids suite green (698 pass), typecheck clean.

### Third batch (same day)

- **A4 — SQL is the source of truth for computed columns**: view-level computed
  columns (`ComputedColumnSpec`) now evaluate in SQL when projectable
  (`buildComputedColumnSqlProjections` in `computed-projections.ts`, wired into
  `records.list`), with the JS evaluator only filling non-projectable remainders
  (`enrichRecordsWithComputedColumns` gained `skipColumnIds`). A saved view's
  computed cell now renders identically to its GQL preview — one semantics
  (NULLIF division, `IS NOT DISTINCT FROM`, decimal-safe), and `FormatSpec`
  applies to the raw value instead of a pre-stringified one. Combined with the
  A5 formula-field inlining, the JS evaluator is now a true edge fallback
  (relation/select/file refs only), not the default path.
- **D1 — one resolver**: `resolveDslQueryToRecordQuery` is now a thin runtime
  check over the single `resolveDslQueryToQueryPlan` (deleted ~330 lines of
  duplicated select/aggregate/sort resolution + dead helpers). Preview and
  records-table execution can no longer drift — they share the exact same
  resolution; the compatibility helper just rejects plan features that
  RecordQuery cannot carry yet, with clear messages.

Full grids suite green (699 pass), typecheck clean, biome clean.

### Fourth batch (same day) — feature clauses + perf

- **C7 — `nulls first` / `nulls last`** sort modifier (parser + resolver + GQL
  sort SQL); defaults to NULLS LAST to match saved views.
- **C8 — `search 'text'`** and `search 'text' in a, b` (parser + resolver →
  `RecordQuery.search`, RecordQuery-compatible). Preview wires the async `compileSearchClause`
  (scalar + relation search, viewer-scoped) as a precompiled predicate into the
  row/group/aggregate compilers.
- **C9 — trash queries**: `include deleted` (live + trashed) and `deleted only`
  (trash view), honored across the row, group, and aggregate GQL compilers;
  parent-table/base liveness still applies.
- **C12 — grouped `median` / `earliest` / `latest`**: expanded the grouped
  aggregate set end-to-end (contracts enum, group-compiler `PERCENTILE_CONT` /
  date MIN/MAX, resolver + sql-compiler), for both field and formula aggregates.
- **A12 — grant batching**: per-table read checks in the GQL resolver context now
  run concurrently (`Promise.all`) instead of a sequential await loop.

Tests: +~25 resolver/parser cases, +1 integration (search). Full grids suite
green (735 pass), typecheck + biome clean.

### Fifth batch (same day) — C3: lookup/rollup in GQL

Lookup/rollup fields are now first-class in GQL: `select rollup`, `where lookup = x`,
`sort rollup`, and as operands inside formulas. `computed-projections.ts` exposes
the correlated subquery as a bare expr + `buildComputedFieldSqlMap`; preview builds
the map async (cross-table, viewer-free reuse of the records-pipeline subqueries)
and threads it through the formula compiler (`computedFieldSql`), the GQL
select/sort/filter, and default-column selection. The resolver carries a
type-only stub so resolve-time validation accepts lookup/rollup before the real
SQL is injected at compile time. Tests: +5 unit (compiler wiring, stub). 738 green.

The original base-table-only limit was removed in later batches: joined
lookup/rollup values now use alias-aware computed SQL maps in row select, sort,
formula output, joined group keys, and direct aggregate expressions.

### Sixth batch — aggregate DRY + source aliases/self-joins

- **D2/D3 — aggregate compatibility/key DRY**: field/formula aggregate
  compatibility, aggregate SQL output typing, and `${fieldId}__${agg}` key
  spelling are centralized in `service/aggregate-capabilities.ts`, with the
  flat aggregate compiler, grouped compiler, GQL resolver/compiler, query
  validation, and dashboard stat readers routed through the same helpers.
- **A3 cleanup**: removed the remaining dead preview sampling knobs
  (`previewBaseLimit` / `baseRecordLimit`) and unit tests now assert that
  aggregate/group previews compile over the full matching set.
- **Validation drift**: saved source/stat trend validation now delegates grouped
  aggregate compatibility to `compileGroupQuery` instead of carrying an old
  allow-list.
- **C15 — source aliases / self-joins**: `from table X as o` parses as a base
  source alias. Scoped base refs such as `o.amount` resolve like normal base
  fields, and relation joins starting from `o.relation = other.id` normalize
  to the base SQL alias `r`, enabling explicit self-joins.

Verification: `cd packages/grids && bun run typecheck`; focused parser/resolver
and compiler tests green; `DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa
GRIDS_QUERY_DSL_DB_TEST=1 bun test` green (727 pass / 15 DB-flagged tests
skipped because they use other opt-in flags).

### Seventh batch — diagnostics + DB matrix

- **A11 first layer — parser diagnostic positions**: parse diagnostics now carry
  optional `column`/`length` metadata for standalone and inline clauses. The
  preview contract preserves those fields and `QueryWorkspace` renders column
  numbers. Resolver/compiler semantic diagnostics remain message-only until AST
  nodes carry source spans.
- **DB-backed GQL matrix**: `sql-compiler.integration.test.ts` now executes 13
  Postgres scenarios, including select label/membership filters, NULLS
  ordering, `deleted only`, date bucketing with `median`/`earliest`/`latest`,
  multi-select grouped explode, and real lookup/rollup computed SQL via
  `buildComputedFieldSqlMap`.

Verification: `cd packages/grids && bun run typecheck`; focused GQL tests green
(141 pass / 13 DB-flagged skips without the DB flag); targeted Biome clean;
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test src/query-dsl/sql-compiler.integration.test.ts` green (13 pass).

### Eighth batch — reverse relation joins

- **C10 — reverse relation joins**: the existing bounded join syntax now supports
  joining records that link back to the current/base scope, e.g.
  `from table Customers as c join table Orders as order on order.Customer = c.id`.
  The resolver records join direction (`forward`/`reverse`), validates that the
  relation field's `targetTableId` matches the source id side, and the SQL
  compiler flips the `record_links` condition (`to_record_id = source.id`,
  joined record = `from_record_id`). Preview fanout caps apply to both
  directions.

Verification: `cd packages/grids && bun run typecheck`; focused resolver +
integration tests green; `DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa
GRIDS_QUERY_DSL_DB_TEST=1 bun test src/query-dsl/sql-compiler.integration.test.ts`
green (14 pass).

### Ninth batch — grouped relation joins

- **C2 — grouped relation joins + joined aggregates**: grouped GQL plans can now
  carry SQL-only group/aggregate metadata with `joinAlias`, so RecordQuery stays
  base-only while preview can group by joined scalar fields and aggregate joined
  numeric/date/text-compatible fields. The grouped compiler uses the same
  relation-join fragments as row queries, then renders `GROUP BY` / aggregate
  SQL directly. Reverse joins work in grouped queries too.
- **Guardrails**: grouped relation joins still reject select output, formula
  aggregates over joins, grouped-join sort clauses, explode group fields
  (relation/multi-select), and computed group fields. Those are explicit
  diagnostics instead of partial SQL.

Verification: `cd packages/grids && bun run typecheck`; focused resolver +
integration tests green; `DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa
GRIDS_QUERY_DSL_DB_TEST=1 bun test src/query-dsl/sql-compiler.integration.test.ts`
green (15 pass).

### Tenth batch — row-shaped view source subqueries

- **C11 — row-shaped saved views as sources**: `from view ...` now supports
  saved view filters, search, record metadata, sort, columns, trash flags, and
  limits without flattening away source semantics. When a source view needs a
  record scope (`search`, `recordMeta`, or `limit`), preview compiles it as an
  inner record-id subquery; the outer DSL `where` / `search` / group / aggregate
  layer then runs over that scoped record set.
- **Correct ordering of semantics**: source `sort + limit` is applied before
  the outer DSL predicate layer, so "top N saved view, then query it" no longer
  degrades into "query first, then top N". For grouped and aggregate previews,
  source view `sort/limit/columns` stay source semantics and are not mistaken
  for group-output sorting or row-column selection.
- **Guardrails**: grouped/aggregate saved views are still rejected as GQL
  sources with a clear diagnostic, because their rows are buckets/aggregate
  outputs, not records. Supporting them would require a separate derived-table
  source model instead of the current record-source pipeline.

Verification: `cd packages/grids && bun run typecheck`; focused resolver +
integration tests green; `DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa
GRIDS_QUERY_DSL_DB_TEST=1 bun test src/query-dsl/sql-compiler.integration.test.ts`
green (17 pass).

### Eleventh batch — semantic diagnostic spans

- **A11 semantic source spans**: parsed GQL nodes now carry source spans through
  references, select items, joins, groups, sorts, aggregates, `where`, `having`,
  and `search`. Resolver diagnostics preserve `line`/`column`/`length`, so
  unknown fields, unsupported scoped operations, RecordQuery blockers, and
  formula/predicate errors can point at the relevant token or expression instead
  of only the clause line.
- **Formula-layer mapping**: `where`/`having` formula AST spans are mapped back
  into the GQL clause span. That keeps typed predicate diagnostics and SQL
  formula compiler errors on the expression that triggered them while preserving
  the existing message shape for API callers.
- **Compatibility**: diagnostic positions stay optional. Post-resolver SQL
  compiler guardrails can still return message-only diagnostics, but the normal
  parser/resolver path now gives the UI enough metadata for precise inline
  highlighting.

Verification: `cd packages/grids && bun run typecheck`; parser/resolver tests
green (133 pass); full Grids suite green (727 pass / 32 opt-in skips);
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test src/query-dsl/sql-compiler.integration.test.ts` green (17 pass).

### Twelfth batch — publishable language UX hardening

- **Canonical syntax cleanup:** GQL rejects legacy `#field` refs, `skip`,
  `ascending`/`descending`, `where formula(...)`, `having formula(...)`,
  `&&`/`||`/bare `!`, logical function calls, `ISEMPTY`/`ISNOTEMPTY`,
  `ANYOF`/`CONTAINSANY`, and scalar `CONTAINSALL`. Diagnostics name the
  replacement syntax.
- **Operator readability:** the formula parser now accepts parenthesized logical
  operands such as `amount > 0 and (cost > 0 or not paid)`, while true logical
  function calls are rejected at the GQL boundary.
- **Scoped relation polish:** `search 'alice' in customer.name` compiles to a
  SQL-only joined search predicate. Grouped relation joins can sort by grouped
  joined fields and aggregate aliases, and can use base-table formula aggregates
  such as `sum(formula(amount - cost)) as margin`.
- **Docs/autocomplete:** query examples, completions, and reference text now
  teach the canonical syntax only. Join completions only offer tables, and
  same-line follow-up clauses require semicolons so the editor matches the
  parser.

Verification: `cd packages/grids && bun run typecheck` green; focused
parser/formula/resolver/compiler/completion tests green (180 pass / 18
DB-flagged skips without the DB flag); full Grids suite green (737 pass / 33
skips); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (755 pass / 15 skips). Targeted Biome over touched Grids files is
clean; root `bun run check:biome` is still blocked by unrelated pre-existing
Cloud UI a11y findings outside the GQL scope.

### Thirteenth batch — scoped formulas over joins + public guardrails

- **Scoped formula refs:** GQL expressions opt into `alias.field` formula refs
  while persisted formula fields stay base-scope-only. `formula(customer.score +
  amount)`, `where customer.score > 5`, and grouped formula aggregates such as
  `sum(formula(customer.score + amount)) as weighted` compile through the real
  joined record aliases (`jq0`, `jq1`, ...), not through JS evaluation.
- **Explicit ambiguity boundary:** scoped formula refs resolve only declared
  source/join aliases. Unknown scopes, unknown joined fields, relation fields,
  multi-selects, JSON, and files fail with direct diagnostics instead of
  falling back to guessed base fields.
- **Save boundary:** computed selects that contain GQL-only scoped refs are
  preview-only. They are not converted into `RecordQuery` computed columns,
  because saved formula-field syntax intentionally does not know join aliases.
- **Guardrail UX:** row-shaped saved views remain valid GQL sources, but
  grouped/aggregate saved views are explicitly rejected as non-record sources.
  Grouped relation joins now explain that group keys must be scalar stored
  fields; relation/multi-select group keys expand to multiple buckets, and
  computed joined group keys need a separate design.
- **Reference text:** the in-app GQL reference now describes the actual join
  surface: joined fields can be selected, sorted, searched, grouped,
  aggregated, and used in formula output through explicit aliases.

Verification: `cd packages/grids && bun run typecheck` green; focused
parser/resolver/compiler tests green (145 pass / 19 DB-flagged skips without
the DB flag); full Grids suite green (743 pass / 35 skips); DB release gate
green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (763 pass / 15 skips). Targeted Biome over touched Grids files is
clean.

### Fourteenth batch — preview relation labels

GQL preview now resolves relation UUID output to user-readable labels before
returning rows. The implementation reuses the central relation-label rule
(presentable fields, first text fallback, `"Untitled record"`) via a small
`buildRelationLabelCacheForIds` helper, so GQL preview does not grow a second
labeling model. Row relation columns and base-table relation group keys are
handled; values remain simple arrays/strings for the existing preview table.

The existing preview truncation contract (`limit + 1`, `truncated: true`, UI
"Limited to N rows") is now covered by the Postgres GQL integration suite.

Verification: targeted Biome over the changed preview/relations/integration
files is clean; `cd packages/grids && bun run typecheck` is green; full Grids
suite is green (743 pass / 35 skips); DB release gate is green (763 pass / 15
skips); targeted DB test
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test src/query-dsl/sql-compiler.integration.test.ts` is green (20 pass).

### Fifteenth batch — view GQL persistence

- **Canonical GQL source:** `query-dsl/canonical.ts` emits deterministic GQL
  with explicit `from table/view {id}`, stable braced field refs, scoped join
  refs, formula refs, aliases, search, trash, sort/nulls, limit/offset, groups,
  aggregates, and having. Golden tests assert idempotence by parse →
  canonicalize → parse → canonicalize.
- **Views are the persisted artifact:** `grids.views` stores canonical GQL
  source text plus the view's owner, read/admin grants, sidebar identity, and
  UI presentation state. Full GQL semantics stay in the canonical source and
  resolved SQL plan; `RecordQuery` remains an internal records-table runtime
  shape, not the persistence format.
- **API + UX path:** view create/update routes parse, resolve, canonicalize,
  and validate the supplied source before writing. Query workspace saves a
  preview-valid query as a View source, and View settings can later inspect or
  edit that source directly.
- **DB coverage:** the opt-in Postgres GQL suite covers view create/list/update
  flows and canonical source persistence without touching other schemas or
  foreign bases.

Verification: targeted Biome clean; `cd packages/grids && bun run typecheck`
green; full Grids suite green (747 pass / 36 skips); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (768 pass / 15 skips); targeted DB test
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test src/query-dsl/sql-compiler.integration.test.ts` green (21 pass).

### Sixteenth batch — first-class view workspace lifecycle

- **Direct routes:** `/app/grids/:base/table/:table` and view routes are the
  canonical workspace entry points. Reloads and client navigation share the
  same view/table workspace state.
- **Catalog + visibility:** workspace state includes visible views. Direct
  links enforce the same owner/read/admin visibility boundary as the view API.
- **Sidebar + active state:** views render as the saved GQL artifacts in the
  table sidebar. The existing Query action remains the ad-hoc explorer for
  drafts and inspection.
- **Update semantics:** View settings update the view's canonical source
  through the view API. Read access lets a user see the view output; admin
  access is required to change the view source, UI settings, or grants.

Verification: targeted Biome clean; `cd packages/grids && bun run typecheck`
green; focused workspace-state tests green (5 pass); full Grids suite green
(750 pass / 36 skips); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (771 pass / 15 skips).

### Seventeenth batch — derived saved-view sources

- **Grouped/aggregate view sources:** `from view ...` now accepts saved
  grouped and aggregate-only `RecordQuery` sources as derived SQL tables instead
  of treating them as record sources.
- **SQL-only derived pipeline:** the compiler wraps the saved grouped/aggregate
  SQL as an inner query, exposes typed output columns, and applies outer
  `select`, `where`, `sort`, `limit`, and `offset` over that derived output.
  Aggregate-only saved views are expanded from the existing JSON result into
  typed SQL columns before the outer query runs.
- **Stable output refs:** canonical GQL emits derived output keys such as
  `"gk_0"`, `"*__count"`, and `"<fieldId>__sum"`, so saved view GQL remains
  stable across label/name edits while users can still author by label.
- **Guardrails:** derived view sources still reject joins, search,
  deleted-row clauses, record-metadata view sources, and re-grouping or
  re-aggregation with direct diagnostics. Those are separate derived-table V2
  semantics, not implicit record-source behavior.

Verification: targeted Biome clean; `cd packages/grids && bun run typecheck`
green; focused canonical/resolver tests green (125 pass); full Grids suite
green (754 pass / 37 skips); targeted Postgres GQL integration green (22 pass);
DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (776 pass / 15 skips).

### Eighteenth batch — search and re-aggregate derived output

- **Derived search:** `search 'text'` now works over derived saved-view output.
  Without `in`, it searches all non-JSON derived columns; with `in`, each
  derived output ref is resolved and validated before SQL compilation.
- **Outer grouping/aggregation:** derived view output can be grouped and
  aggregated again with normal GQL syntax. This compiles as an outer SQL layer
  over the saved-view subquery, including `having`, grouped sort by aggregate
  aliases, `nulls first/last`, `limit`, and `offset`.
- **Stable canonical refs:** canonical GQL now emits stable derived refs through
  `search`, `group by`, aggregate arguments, `having`, and grouped sort. Users
  can author by label, but persisted view GQL keeps output keys.
- **Guardrail kept:** joins over derived sources still fail clearly. A derived
  row has no record id or relation-link lifecycle, so join semantics need a
  separate product decision instead of an implicit SQL guess.

Verification: targeted Biome clean; `cd packages/grids && bun run typecheck`
green; focused canonical/resolver tests green (128 pass); targeted Postgres
GQL integration green (23 pass); full Grids suite green (757 pass / 38
skips); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (780 pass / 15 skips).

### Nineteenth batch — exploded joined group keys

- **Joined relation group keys:** grouped relation-join queries can now group by
  relation fields on the joined table. The compiler emits the same SQL-only
  explode semantics as the base group compiler: one bucket per linked
  `record_links.to_record_id`.
- **Joined multi-select group keys:** grouped relation-join queries can now
  group by multi-select fields on the joined table. The compiler expands the
  stored JSON array with `jsonb_array_elements_text`, producing one bucket per
  selected option.
- **Preview metadata:** group output metadata now carries the group field's
  source table id, so relation labels for joined group keys can resolve through
  the existing preview label path. Joined explode group keys also surface
  `explode: true`, and grouped joined queries without an explicit aggregate
  return the same visible `*__count` metric as the base grouped path.
- **Guardrails kept at this point:** computed joined group keys, including
  joined formula/lookup/rollup fields, still failed clearly. This guardrail was
  removed in the twentieth batch after scoped computed projections became
  alias-aware. Relation group keys also keep the relation target read gate, so
  grouping cannot expose unreadable target-table record ids.

Verification: targeted Biome clean; `cd packages/grids && bun run typecheck`
green; focused resolver tests green (121 pass); targeted Postgres GQL
integration green (24 pass); full Grids suite green (757 pass / 39 skips); DB
release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (781 pass / 15 skips).

### Twentieth batch — joined computed fields

- **Alias-aware computed projections:** lookup/rollup SQL projection building now
  accepts a record alias, guarded through `assertSqlIdentifier`, while preserving
  the base-table default alias `r`. Preview builds a `joinAlias -> computed SQL`
  map for every joined table using the real joined record aliases (`jq0`, ...).
- **Joined lookup/rollup row surface:** `select customer.lookup`, `sort
  customer.rollup`, and `formula(customer.lookup + 1)` now resolve and compile
  through the same scoped-field model as normal joined scalar fields. Missing
  computed SQL maps still fail loudly with "not available in this query" instead
  of falling back to JS.
- **Computed joined group keys:** grouped relation-join queries can now group by
  joined formula, lookup, and rollup fields when they are SQL-projectable. Base
  grouped RecordQuery behavior stays unchanged; this remains a SQL-only GQL
  preview feature.
- **Exact grouped previews:** the row-preview fanout cap stays on row-shaped
  previews, but grouped/aggregate previews no longer pass `joinFanoutLimit`, so
  grouped relation joins compute exact buckets under the existing statement
  timeout instead of silently sampling linked rows.
- **Grouped joined null ordering:** `sort customer.field nulls first/last` now
  carries through SQL-only grouped-join plans for both group keys and aggregate
  alias sorts.

Verification: targeted Biome clean; `cd packages/grids && bun run typecheck`
green; focused resolver tests green (121 pass / 709 expects); targeted Postgres
GQL integration green (26 pass / 287 expects); full Grids suite green (757 pass
/ 41 skips / 2655 expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (783 pass / 15 skips / 2942 expects).

### Twenty-first batch — direct computed aggregates

- **No wrapper tax for computed values:** `aggregate sum(total) as revenue` and
  `aggregate sum(customer.lookup_total) as revenue` now route through the same
  SQL formula-aggregate path as `sum(formula(...))`, using the real
  `computedFieldSql` / `computedFieldSqlByJoinAlias` maps. Plain `RecordQuery`
  remains unchanged; these SQL-only aggregates stay in the GQL plan until the
  records-table runtime can represent them directly.
- **Type safety at the SQL boundary:** lookup/rollup fields resolve with a
  type-only placeholder, then the compiler validates the injected SQL type
  before rendering the aggregate. `sum(text_lookup)` fails with a direct type
  diagnostic instead of silently casting or producing null-shaped output.
- **Alias consistency:** aggregate alias uniqueness, grouped sort, and `having`
  now all use the same case-insensitive normalization. `Metric` and `metric`
  are rejected as one alias, and `having metric > 0` resolves the same alias as
  `sort metric`.
- **DB coverage:** Postgres integration now executes direct base lookup/rollup
  aggregates and direct joined lookup/rollup aggregates, including `sum` and
  `avg`, with exact expected values.

Verification: targeted Biome clean; `cd packages/grids && bun run typecheck`
green; focused resolver tests green (126 pass / 741 expects); targeted
Postgres GQL integration green (26 pass / 308 expects); full Grids suite green
(762 pass / 41 skips / 2687 expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (788 pass / 15 skips / 2995 expects).

### Twenty-second batch — explicit case-insensitive text predicates

- **One explicit way for per-field case-insensitive text matching:** GQL now
  supports `icontains(field, 'text')`, `istartswith(field, 'text')`, and
  `iendswith(field, 'text')`. They are not SQL pattern syntax; they are the
  case-insensitive counterparts to the existing field-scoped
  `contains`/`startswith`/`endswith` predicates.
- **SQL-only execution:** the resolver emits the existing typed filter leaf with
  `caseInsensitive: true`; the shared filter compiler renders the already
  escaped `LIKE` predicate over `LOWER(field)`. No JS filtering/evaluation was
  introduced.
- **Clear guardrails:** the functions keep the same arity/type checks and
  positioned diagnostics as the case-sensitive text predicates. Select and
  relation membership still use `oneof`/`noneof`, not text matching.

Verification: `cd packages/grids && bun run typecheck` green; focused resolver
tests green (127 pass / 750 expects); targeted Postgres GQL integration green
(27 pass / 320 expects); full Grids suite green (763 pass / 42 skips / 2696
expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (790 pass / 15 skips / 3016 expects).

### Twenty-third batch — positioned preview compiler diagnostics

- **A11 compiler tail closed for preview guardrails:** resolved SQL query plans
  now retain minimal diagnostic spans for source, select, where, group keys,
  aggregates, having, sort, and search. Group keys keep resolved labels, so
  compiler errors such as `field "Lookup total" ... not available` map to the
  exact authored `group by` item instead of the raw ref spelling.
- **Preview/API mapping:** low-level compiler string failures are converted
  through `dslPreviewDiagnosticForCompilerError` before the preview API returns
  diagnostics. Recognized where/having/select/aggregate/group/sort/search/source
  failures get source positions; unrecognized internal failures stay
  message-only by design.
- **No SQL semantic change:** SQL compilers still fail fast with simple strings;
  this layer only preserves enough resolved-plan context to report the failure
  at the right GQL clause.

Verification: `cd packages/grids && bun run typecheck` green; focused resolver
tests green (127 pass / 752 expects); targeted Postgres GQL integration green
(27 pass / 320 expects); full Grids suite green (763 pass / 42 skips / 2698
expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (790 pass / 15 skips / 3018 expects).

### Twenty-fourth batch — derived relation output joins

- **Explicit derived join semantics:** grouped/aggregate saved-view output still
  has no implicit record identity, but relation group-output columns now carry
  their target table id. GQL can join those relation-record-id outputs to the
  target table's `alias.id`, e.g. `from view BYCUS join table Customers as
  customer on Customer = customer.id`.
- **No SQL-clone guessing:** scalar group columns, aggregate output, and the
  derived source itself are not joinable. The resolver rejects them with direct
  diagnostics instead of inventing equality-join semantics.
- **SQL-only joined output:** derived relation joins compile as joins from the
  derived subquery column to live target records, with target table/base liveness
  checks. Joined target fields can be selected and sorted, including
  lookup/rollup fields through the same alias-aware computed SQL map used by
  normal joins.
- **Guardrails kept:** re-grouping after a derived join remains blocked until
  aggregate semantics over joined-derived rows are designed. Joined-derived
  `where`/`search` and dashboard-widget consumption are still out of scope.

Verification: `cd packages/grids && bun run typecheck` green; focused resolver
tests green (128 pass / 766 expects); targeted Postgres GQL integration green
(28 pass / 329 expects); full Grids suite green (764 pass / 43 skips / 2712
expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (792 pass / 15 skips / 3041 expects).

### Twenty-fifth batch — joined-derived predicates and regrouping

- **Joined-derived predicates:** derived relation-output joins now participate
  in outer `where` and `search`. Unscoped refs still mean derived output
  columns; scoped refs such as `customer.score` or `customer.name` resolve only
  through declared joined aliases.
- **Re-grouping after derived joins:** outer derived queries can group by joined
  fields and aggregate derived output or joined fields in one SQL layer. Formula
  aggregates can mix derived output and joined fields, e.g.
  `sum(formula(revenue + customer.score))`.
- **Search stays one clause:** derived output search and joined search are split
  at resolve time, compiled through their proper SQL builders, and OR-combined
  as one user-authored `search` clause.
- **No JS fallback:** grouped derived joins render as `FROM (<saved-view SQL>) d`
  plus explicit join fragments, then `WHERE` / `GROUP BY` / `HAVING` / `ORDER BY`
  over SQL expressions only.

Verification: `cd packages/grids && bun run typecheck` green; focused resolver
tests green (129 pass / 780 expects); targeted Postgres GQL integration green
(29 pass / 339 expects); full Grids suite green (765 pass / 44 skips / 2726
expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (794 pass / 15 skips / 3065 expects).

### Twenty-sixth batch — permission-sensitive relation/search coverage

- **Relation labels:** Postgres integration now covers preview relation-label
  output with a non-admin viewer that has no target-table grants. Linked target
  records render as `"Unknown record"`; the admin/readable path still resolves
  `"Alice"` / `"Bob"`.
- **Relation search:** scoped relation search (`search 'Alice' in CUSTL`) is
  default-deny for that same non-admin viewer and still returns the linked order
  for an admin/readable viewer.
- **No `auth` fixture writes:** the test exercises the real grant loader against
  the temporary Grids fixture but does not create, modify, or delete data in the
  `auth` schema.

Verification: `cd packages/grids && bun run typecheck` green; full local Grids
suite green (765 pass / 45 skips / 2726 expects); targeted Postgres GQL
integration green (30 pass / 359 expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (795 pass / 15 skips / 3085 expects).

### Twenty-seventh batch — dashboard backend GQL consumption contract

- **Backend execution path:** the dashboard resolver executes persisted view GQL
  sources for dashboard-style consumers without introducing a second evaluator.
  It loads the saved view source, builds a base-scoped dashboard resolver
  context, resolves the plan, and delegates to `previewDslQuery`.
- **Same SQL semantics:** dashboard GQL consumption inherits preview's SQL-only
  compiler path, lookup/rollup/formula SQL maps, statement timeout, compiler
  diagnostics, and relation viewer-gating.
- **Saved-view sources:** the dashboard resolver context includes live saved
  views in the base, so a persisted GQL query such as `from view ...` works
  through the backend contract as well.
- **No frontend wiring:** this batch deliberately does not modify dashboard
  components, editors, or templates. Exposing GQL as a visible widget source is
  a separate UI/product integration step.

Verification: `cd packages/grids && bun run typecheck` green; targeted Postgres
GQL integration green (32 pass / 374 expects); full local Grids suite green
(765 pass / 47 skips / 2726 expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (797 pass / 15 skips / 3100 expects).

### Twenty-eighth batch — canonical language guardrails

- **Predicate canonical spelling:** canonical saved GQL now emits Grids-specific
  predicate helper functions in the public lowercase form (`oneof`,
  `contains`, `icontains`, ...), while ordinary formula functions such as
  `IF(...)` keep the formula-engine spelling.
- **Removed alias diagnostics:** `ANYOF(...)` and `CONTAINSANY(...)` now fail in
  the resolver with a direct `use oneof(field, ...)` diagnostic instead of
  surfacing as generic unknown formula functions.
- **Legacy syntax golden matrix:** parser tests now pin the release boundary for
  removed public syntax: `#` refs in sources/select/aggregate/search, `skip`,
  `ascending`/`descending`, `&&`/`||`/`!`, and `where`/`having formula(...)`.
  This protects the "one obvious way" language contract without adding frontend
  wiring or alternate spellings.

Verification: focused parser/canonical/resolver tests green (167 pass / 976
expects); `cd packages/grids && bun run typecheck` green; full local Grids
suite green (768 pass / 47 skips / 2763 expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (800 pass / 15 skips / 3137 expects).

### Twenty-ninth batch — backend release guardrails

- **Case-folded alias identity:** source aliases, join aliases, select aliases,
  and aggregate aliases now reject case-only collisions consistently. Canonical
  output resolves join scopes case-insensitively too, so `Customer.name` and
  `customer.name` do not create divergent semantics.
- **Stable select option persistence:** canonical GQL rewrites editable select
  option labels to option ids in comparisons and membership predicates. Unknown
  or ambiguous labels fail with direct diagnostics instead of persisting unstable
  display text.
- **Service-level canonicalization:** view create/update now parses, resolves,
  and canonicalizes against the base's live tables, views, and fields before
  writing. A saved source whose `from` table/view resolves to a different root
  table than the supplied `tableId` is rejected.
- **Scoped text predicates over joins:** the text predicate family
  (`contains`, `startswith`, `endswith`, and case-insensitive variants) is
  supported by the formula SQL compiler, so joined predicates like
  `icontains(customer.name, 'al')` execute in SQL instead of failing as unknown
  formula functions.
- **View dashboard visibility:** dashboard view resolution mirrors view
  visibility policy: read access or admin only. Other viewers get a neutral not
  found diagnostic instead of an existence leak.
- **Public route concentration:** the legacy `/query-dsl` API alias was dropped;
  `/gql` is the single public backend route for GQL.

Verification: focused formula/resolver tests green (191 pass / 917 expects);
targeted Postgres GQL integration green (34 pass / 394 expects);
`cd packages/grids && bun run typecheck` green; full local Grids suite green
(771 pass / 49 skips / 2790 expects); DB release gate green with
`DATABASE_URL=postgresql://ipa:ipa@localhost:5432/ipa GRIDS_QUERY_DSL_DB_TEST=1
bun test` (805 pass / 15 skips / 3184 expects).

### Thirtieth batch — GQL API contract coverage

- **Testable route construction:** `api/gql.ts` now exposes a small
  `createGqlApi` factory so backend tests can inject an authenticated actor
  while the production default export still uses `auth.requireRole("authenticated")`.
  This keeps auth behavior unchanged and avoids token/session fixture hacks.
- **Public route contract:** the mounted Grids API is covered at the route
  boundary: `/gql/...` is present and auth-protected, while the removed legacy
  `/query-dsl/...` alias returns 404.
- **Precise source responses:** the view routes declare the actual transport
  contract explicitly: create/update validate GQL through parser,
  resolver, and canonicalizer before persistence and return diagnostics instead
  of silently accepting invalid source text.
- **Admin list visibility:** the view list path matches direct view read
  policy. Base admins can list private views in the base; non-admin callers see
  only views they can read.
- **Neutral mutation privacy:** view `PATCH`, `DELETE`, and restore run the
  same readability precheck as direct `GET` before mutation gates. Unreadable
  view ids return neutral not-found responses instead of leaking existence
  through `403` vs `404` differences.
- **Saved-source persistence:** view create/update routes are covered through
  Hono against Postgres. The test verifies that editable field names and select
  labels are persisted as canonical table/field ids and option ids.
- **Implicit source contexts:** route coverage also pins `currentSource` for
  table and view contexts, so query-workspace saves without an explicit `from`
  clause still persist with a stable canonical `from table {id}` /
  `from view {id}` source.
- **Readable API diagnostics:** parser and canonicalization failures return
  `{ ok: false, diagnostics }` at the API boundary instead of generic 500/400
  transport errors.
- **DB hygiene:** the route test writes only temporary Grids fixtures and
  cleans temporary `grids.audit_log` rows explicitly. It reads one existing
  `auth.users` id for the audit-log actor FK, but does not create, update, or
  delete data outside the `grids` schema.

Verification: `cd packages/grids && bun run typecheck` green; full local Grids
suite green (771 pass / 55 skips / 2790 expects); targeted Postgres GQL API
integration green
(`GRIDS_QUERY_DSL_DB_TEST=1 bun test src/api/gql.integration.test.ts`:
6 pass / 32 expects).

### Thirty-first batch — explicit comment truncation diagnostics

- **No silent `--` truncation:** SQL-style comments remain supported, including
  whole-line comments and ` -- comment` after clauses, but a marker attached
  directly to expression text now fails with a positioned diagnostic. Queries
  like `where Amount--1` no longer compile as if the user had typed
  `where Amount`; the parser says to write ` --` for comments or add spaces
  around subtraction.
- **Existing literal/id behavior preserved:** `--` inside quoted strings and
  braced stable ids still parses as data, not as comments.

Verification: focused parser test green
(`bun test packages/grids/src/query-dsl/parser.test.ts`: 30 pass / 143
expects); `cd packages/grids && bun run typecheck` green; full local Grids
suite green (772 pass / 55 skips / 2792 expects); targeted Postgres GQL API
integration green
(`GRIDS_QUERY_DSL_DB_TEST=1 bun test src/api/gql.integration.test.ts`:
6 pass / 32 expects).

### Thirty-second batch — grammar convergence + derived saved-search fix

- **P1 derived saved-view search:** grouped/aggregate saved views used as
  derived GQL sources now compile their own saved `search` clause before outer
  derived grouping or aggregation. A saved grouped view like "Open status
  summary" no longer re-aggregates all status buckets when its source view had
  a saved search scope.
- **No untyped sources:** `from Orders` is rejected with a direct diagnostic.
  Public authored GQL keeps one explicit source spelling: `from table ...` or
  `from view ...`; omitted source remains available only through the
  API/workspace `currentSource` and is persisted canonically.
- **No whitespace wrapper escape:** `where formula (...)` now gets the same
  replacement diagnostic as `where formula(...)`; predicates use direct formula
  syntax.
- **Reserved keyword concentration:** aliases now reject GQL clause/modifier
  words such as `search`, `include`, `deleted`, `skip`, `ascending`,
  `descending`, and `nulls`, avoiding confusing aliases that later collide with
  grammar diagnostics.
- **Canonical alias casing:** references can resolve aliases
  case-insensitively, but canonical saved GQL emits the declared alias casing
  (`Customer.Name` with `as customer` persists as `customer.{fieldId}`).

Verification: focused parser/resolver/canonical/source-plan tests green
(176 pass / 1011 expects); `cd packages/grids && bun run typecheck` green; full
local Grids suite green (772 pass / 56 skips / 2794 expects); targeted
Postgres derived-search regression green (1 pass / 6 expects); targeted
Postgres GQL API integration green (6 pass / 32 expects).

### Thirty-third batch — derived relation search label semantics

- **P2 derived relation search:** `search 'Alice' in Customer` on a saved
  grouped-view source now searches the same target label fields used by normal
  relation search and preview labels. It no longer searches raw derived UUID
  text.
- **Permission shape kept:** if the target table is not readable or has no
  searchable label fields, that relation column contributes no search predicate
  instead of falling back to UUID matching.
- **DRY helper:** normal relation search and derived relation search now share
  the direct scalar/select field-search helper and LIKE escaping.

Verification: `cd packages/grids && bun run typecheck` green; focused local
search/resolver/canonical tests green (165 pass / 897 expects); targeted
Postgres SQL compiler integration green (36 pass / 412 expects), including
derived relation label search and raw-UUID non-match; full local Grids suite
green (772 pass / 57 skips / 2794 expects); `git diff --check` clean.

### Thirty-fourth batch — field SQL type metadata hardening

- **Central field SQL typing:** `field-storage.ts` now owns scalar, output, and
  grouped-output SQL type helpers. Formula SQL typing, aggregate compatibility,
  resolver metadata, and the GQL SQL compiler all delegate to the same source.
- **System fields fixed:** `created_at` / `updated_at` / `deleted_at` are typed
  as datetime, while `created_by` / `updated_by` are typed as text. System user
  fields no longer flow into date aggregates or timestamp casts.
- **Grouped bucket metadata fixed:** grouped select and relation output reports
  the SQL bucket type (`text`) instead of the field's normal row output type
  (`json`).
- **Derived search parity:** derived select group columns search option labels
  rather than raw ids; derived relation label search now also works through the
  public API and dashboard backend paths because required target-table fields
  are hydrated after plan resolution.
- **Aggregate-only system counts:** flat aggregate previews now count system
  columns through their real record-table projections instead of `data->>field`.
- **API viewer parity:** GQL preview passes admin status into relation
  label/search expansion, matching the rest of the Grids API permission model.

Verification: `cd packages/grids && bun run typecheck` green; focused
formula/resolver/aggregate/group/source-plan tests green (194 pass / 3 skips /
999 expects); targeted Postgres SQL compiler integration green (38 pass / 431
expects); targeted Postgres GQL API integration green (7 pass / 38 expects);
full local Grids suite green (774 pass / 60 skips / 2805 expects);
`git diff --check` clean.

### Thirty-fifth batch — base computed group keys

- **Computed grouping parity:** base-table formula, lookup, and rollup fields
  can now be used as GQL `group by` keys when they are SQL-projectable. This
  removes the old asymmetry where computed values were selectable, filterable,
  sortable, aggregatable, and groupable through joins, but not groupable on the
  source table itself.
- **SQL-only execution:** computed group keys route through the existing
  `sqlGroupBy` compiler path and reuse the same formula / lookup / rollup SQL
  projections as row select, sort, filter, and aggregate paths. No JS grouping
  or evaluation was added.
- **Persistence boundary kept explicit:** RecordQuery conversion still rejects
  computed group keys with a direct diagnostic; GQL preview/execution is the
  supported backend path until the records-table runtime can model computed
  group keys directly.

Verification: `cd packages/grids && bun run typecheck` green; focused
resolver/group-compiler tests green (161 pass / 880 expects); targeted Postgres
SQL compiler integration green (39 pass / 446 expects), including base formula,
lookup, and rollup group keys; full local Grids suite green (776 pass / 61
skips / 2817 expects); `git diff --check` clean.

### Thirty-sixth batch — aggregate-only relation joins

- **Aggregate-only join parity:** relation joins now work for aggregate-only GQL
  queries without `group by`. Users can summarize joined records directly, for
  example `aggregate sum(customer.Score)` or `sum(formula(Amount +
  customer.Score))`.
- **One SQL path:** the resolver routes join-backed aggregate-only queries
  through the grouped SQL compiler with zero group keys. This keeps joined field
  aggregates, formula aggregates, filters, permissions, and relation join SQL on
  the same backend path as grouped relation joins.
- **No row fallback:** row-query compilation still rejects aggregate-only shapes
  and aggregate-only plans still reject row columns. The new support is SQL-only
  and does not add JS aggregation or evaluation.

Verification: `cd packages/grids && bun run typecheck` green; focused resolver
tests green (136 pass / 832 expects); targeted Postgres aggregate-only relation
join integration green in the `app-grids` container because the host Postgres
port was unavailable (1 pass / 8 expects); full targeted Postgres SQL compiler
integration green in the container (40 pass / 454 expects); full local Grids
suite green (777 pass / 62 skips / 2827 expects); `git diff --check` clean.

### Thirty-seventh batch — ambiguity guardrails and chained derived joins

- **Alias identity consistency:** join aliases now match case-insensitively in
  join predicates and later scoped refs. `join table Customers as Customer on
  customer_link = customer.id` resolves to the declared alias instead of
  failing on casing.
- **Aggregate alias ambiguity closed:** aggregate aliases can no longer collide
  with source fields, source/join/select aliases, derived output refs, or group
  keys. This keeps `sort Status` and `having Status > 0` from guessing between
  a grouped field and an aggregate output.
- **Chained derived joins fixed:** grouped/re-aggregated derived view sources now
  materialize chained relation joins before grouped SQL compilation. A query can
  join a derived relation-output column, join again from that joined record, and
  use the second alias in `search`, `where`, `group by`, and formula
  aggregates.
- **No redesign needed:** the unframed language/backend reviews found
  consistency gaps inside the current syntax model, not a release-blocking need
  for a broad language redesign.

Verification: `cd packages/grids && bun run typecheck` green; focused resolver
tests green (139 pass / 851 expects); targeted Postgres chained-derived-join
regression green in the `app-grids` container (1 pass / 9 expects); full
targeted Postgres SQL compiler integration green in the container (41 pass /
463 expects); full local Grids suite green (780 pass / 63 skips / 2846
expects); `git diff --check` clean.

### Thirty-eighth batch — final backend release-gate audit

- **DB harness stability:** opt-in Postgres integration files no longer close
  Bun's shared `sql` pool from file-local `afterAll` hooks. The documented
  `GRIDS_QUERY_DSL_DB_TEST=1 bun test` gate now runs as one full package command
  instead of failing later files with `ERR_POSTGRES_CONNECTION_CLOSED`.
- **Decimal output parity:** SQL-projected formula fields and GQL preview numeric
  SQL values now canonicalize decimal strings with the formula engine's Decimal
  renderer. Nested SQL formulas such as `Subtotal + 1` therefore render the same
  value shape as the JS fallback (`1.3`, not PostgreSQL's scale-preserved
  `1.300`).
- **All-DB smoke:** the stronger combined DB gate also runs the record SQL
  formula, formula-SQL compiler, and named-ref opt-in suites alongside the GQL
  suite.

Verification: `cd packages/grids && bun run typecheck` green; full local Grids
suite green (780 pass / 63 skips / 2846 expects); documented DB gate green in
the `app-grids` container with `GRIDS_QUERY_DSL_DB_TEST=1 bun test` (828 pass /
15 skips / 3348 expects); stronger all-opt-in DB gate green with
`GRIDS_QUERY_DSL_DB_TEST=1 GRIDS_SQL_COMPILER_DB_TEST=1
GRIDS_RECORD_SQL_FORMULA_DB_TEST=1 GRIDS_NAMED_REFS_DB_TEST=1 bun test` (843
pass / 3422 expects); scoped Biome over the changed Grids backend files clean;
`git diff --check` clean. Root `bun run check:biome` currently fails in
pre-existing `packages/cloud/src/ui/*` a11y findings outside Grids and was left
untouched.

**Dashboard integration status:** completed after the backend contract pass.
Dashboard widgets resolve saved view sources through the GQL parser, resolver,
and preview/runtime path instead of the old view-query/stat-source shape.

---


Date: 2026-06-12 · Scope: `packages/grids/src/query-dsl/`, expression layer (`formula/`, `service/formula-sql-compiler.ts`), downstream compilers (`filter/sort/group/aggregate-compiler.ts`, `field-storage.ts`), API (`api/gql.ts`), frontend (`QueryWorkspace.tsx`, `query-completions.ts`).

Method: full source read of the pipeline, verification of all claims against code (two agent-assisted sweeps over tests and security surface, every agent finding re-verified by hand — two reported "HIGH" injection findings were **downgraded** after verification, see §B).

Guiding constraints from product owner: **100% SQL execution** (no JS aggregation/evaluation), KISS, DRY, perfect UX. Breaking changes allowed (alpha).

---

## A. Bugs & Correctness

### A1 — Select fields are effectively unusable in GQL ⚠️ top user-reported issue
Three compounding problems:

1. **No SQL projection in formulas.** `field-storage.ts:195` gives select `kind: "jsonbArray"`, `project: () => null`. Any formula use (`where status = 'x'` falling back to formulaWhere, `CONTAINS(...)`, select inside `formula()`) dies with *"Field … (select) cannot be compiled into SQL formulas yet"* (`formula-sql-compiler.ts:336`).
2. **FilterTree path compares against option IDs, not labels.** `resolver.ts:592-595` maps `=`→`is`, `!=`→`isNot`; the literal goes through unchanged. `filter-compiler.ts:383` renders `data->fieldId @> '["<literal>"]'`. Stored values are option **IDs** (`select.ts` validate). A user typing `status = 'Open'` (the label) silently gets **zero rows** — worst possible failure mode.
3. **Double-quote trap.** `status = "Open"` parses `"Open"` as a **field ref** (quoted identifiers). FilterTree path errors with *"filter comparisons must compare one field to one literal"*, then the formulaWhere fallback hits problem 1. The user sees the misleading "select not implemented" error.

**Fix direction (KISS):** in the resolver, resolve select literals **label→option-id** (case-insensitive, also accept raw id; error listing valid options on miss). Add a single-select SQL projection (`data->fieldId->>0`) to enable formula use for `multiple: false`; keep `@>` semantics for multi-select via `is/isNot/isAnyOf`. Add a "did you mean single quotes?" hint when a quoted ref in value position doesn't resolve to a field.
**Status:** fixed: select labels and ids resolve to stored option ids, invalid
labels fail with valid options, select predicate helpers route through the typed
SQL predicate layer, and the integration suite covers select label/membership
behavior.

### A2 — NULLS ordering parity bug (preview ≠ saved view)
`query-dsl/sql-compiler.ts:397` hardcodes `asc → NULLS FIRST`. The saved-view path (`sort-compiler.ts:224`) defaults `nullsFirst=false` → `NULLS LAST`. Group compiler always emits `NULLS LAST`. Same query sorted asc shows different row order in GQL preview vs the saved view. Also: GQL has **no syntax** for nulls placement.
**Status:** fixed: GQL defaults to saved-view-compatible `NULLS LAST` and
supports explicit `nulls first` / `nulls last`.

### A3 — Silent sampling makes aggregate/grouped previews wrong
`preview.ts:18` `MAX_PREVIEW_SCAN_ROWS = 5_000`: aggregate-only and grouped previews compute over `(SELECT … ORDER BY r.id LIMIT 5000)` (`sql-compiler.ts:847-855`, `group-compiler.ts:671-681`). On tables >5k rows the preview shows **wrong sums/counts with no indication** — response has no `sampled` flag, UI shows nothing. A saved view source can then produce different numbers than the preview did. Directly contradicts the SQL-correctness goal.
**Fix:** drop the sampling (V1 query audit measured 100k-row aggregates at 39–166 ms) and protect with `SET LOCAL statement_timeout` instead; or, if kept, return + render a "computed over first N records" banner.
**Status:** fixed: aggregate/grouped previews no longer sample silently and run
under a transaction-scoped statement timeout.

### A4 — JS vs SQL semantic drift (the "100% SQL" gap)
GQL preview compiles formula selects/predicates to **SQL**. Older view setup stored them as `ComputedColumnSpec`, which the records pipeline evaluated in **JS** (`computed-projections.ts: enrichRecordsWithComputedColumns`, per V1 design "display-only columns"). Known divergences for the *same expression*:
- `1/0`: SQL → `NULL` (`NULLIF`), JS → `#DIV/0` error sentinel.
- `=`: SQL `IS NOT DISTINCT FROM` with type coercion; JS strict `===` (plus nullish special-case).
- Boolean/text coercions (`asBoolean`/`asText` COALESCE defaults) vs JS truthiness rules.
- Decimal handling: JS uses Decimal.js for decimal-string shapes; SQL uses `numeric` (usually agrees, but formatting differs).
Additionally formula *fields* of non-SQL-safe shape fall back to JS enrichment in the records pipeline.
**Fix:** make ComputedColumnSpec evaluation use `compileFormulaSourceToSql` in `records.list` (infrastructure exists — formula fields already project via SQL there). Then delete the JS evaluation path for view columns; one semantics, SQL.
**Status:** fixed for GQL execution and RecordQuery boundaries: GQL preview and
view source execution run in SQL, RecordQuery conversion rejects computed
selects that cannot compile to SQL, and SQL-projectable RecordQuery computed
columns are projected in SQL. SQL-projected decimal formula outputs are
normalized through the same Decimal renderer as the JS formula engine. The
remaining JS evaluator is a
non-GQL fallback for non-projectable general RecordQuery computed columns.

### A5 — Formula fields can't be referenced inside expressions
Top-level `select myFormulaField` works (`sql-compiler.ts:232-239` special-cases formula fields and inlines them). But `myFormulaField` **inside** any expression (`where`, `formula()` select, aggregate argument) fails — `formula-sql-compiler.ts:332-336` only consults `storageOf().project()` which is null for formula. Inconsistent and surprising: users see the field work in `select` but not in `where`.
**Fix:** recursive inlining in `compileExpr` with a depth cap + cycle guard (`collectFieldRefs` already exists for cycle detection).
**Status:** fixed: formula fields inline recursively in SQL with cycle and depth
guards, including predicates, sorts, formula select output, and aggregates.

### A6 — `--` comment stripping is paren-unaware
`parser.ts:78-107` strips `--` outside quotes/braces but inside parens too: `where a - -1` written as `a--1` truncates to `a` → "missing expression" with no hint. Same as SQL, but our error message doesn't say "comment started here". Low priority; improve the diagnostic.
**Status:** fixed: attached `--` markers now produce a positioned parser
diagnostic instead of silently truncating the expression. Whitespace-separated
comments remain valid.

### A7 — Duplicate-aggregate silent skip in service layer
`group-compiler.ts:414-415` (`if (seenKeys.has(key)) continue`) silently drops duplicates. The GQL resolver pre-validates with a diagnostic so it's unreachable from GQL, but the service contract is "silently ignore" vs resolver's "error" — drift risk. Make the service reject too (aggregate-compiler already does).
**Status:** fixed: grouped aggregate compilation rejects duplicate `(field, agg)`
requests like the flat aggregate compiler.

### A8 — Preview limit silently diverges from saved limit
Preview clamps to 500 (`preview.ts:17`); parser allows `limit 10000`; saved view keeps 10000. No hint shown when clamped. Minor — show "preview capped at 500".
**Status:** fixed in preview: the response carries `truncated` when the preview
is capped, the UI shows `Limited to N rows`, and the DB integration suite
covers the metadata.

### A9 — Relation columns in preview show raw UUID arrays
Default row output includes relation fields as `jsonb_agg(to_record_id)` (`sql-compiler.ts:246-256`); the preview table renders raw UUIDs. The records view shows labels. Poor UX, makes joins look broken.
**Fix:** project a label subquery (target table's presentable/first-text field) like `relations.relationLabelFields`, or render link chips via `recordId`+`tableId` lookup.
**Status:** fixed in preview by resolving raw relation UUID values through the
shared relation-label resolver before returning row preview values.

### A10 — Explode-mode not surfaced in grouped preview
Multi-select/relation grouping explodes (one record → N buckets); `TableQueryResponse` carries `explode`, the GQL preview response doesn't. Counts can exceed record count with no explanation.
**Status:** fixed: grouped preview carries `explode`, and the preview UI explains
overlapping buckets.

### A11 — Resolver/compiler diagnostics carry no position
`DslParseDiagnostic` has `line`; `DslResolverDiagnostic` is message-only. The formula AST has `SourceSpan`s — unused. Long queries get errors with no location. UX: thread spans/lines through resolve + compile diagnostics; highlight in editor.
**Status:** fixed for normal parser/resolver diagnostics and preview compiler
guardrails with unambiguous clause/field context. Ambiguous internal compiler
failures intentionally stay message-only instead of guessing.

### A12 — Per-keystroke permission fan-out (perf)
`api/gql.ts:49-52` runs `gateAt` (each a `loadGrantsForUser` query) **per table in the base, sequentially**, on every preview request (debounced 250 ms client-side, but still per keystroke-pause). A 30-table base = 30 sequential grant queries + views + fields. Batch into one grant load (the UNION-ALL loader already supports it) and parallelize field loads.
**Status:** fixed by concurrent per-table read checks in the resolver context.

---

## B. Security (verified; agent claims corrected)

### B1 — `sql.unsafe` identifier rendering is safe today, but fragile (hardening)
All `sql.unsafe` sites were traced:
- Generated aliases (`q_col_N`, `jq/jql N`, `gk_N`, `rl_/ms_N`, positional GROUP BY ints) — not attacker-controllable. ✅
- `recordAlias` — guarded by `SQL_ALIAS` regex (`formula-sql-compiler.ts:356`). ✅
- `aggregateOrderPart` (`group-compiler.ts:541`) interpolates `"<fieldId>__<agg>"` — fieldId is Zod-validated `uuid | "*"` (contracts:447) on the API path and regex-validated (`FORMULA_AGG_ID`, `ALIAS_RE`) on the GQL path. ✅ today, but **one missed validation in any future caller = SQL injection**. An agent flagged this as exploitable HIGH; verification shows all paths validate. Still: add a central `assertSqlIdentifier()` used at every `sql.unsafe` identifier site (defense in depth, one-line cost).
- `field-storage.ts:92` `sql.unsafe(\`${alias}.data\`)` — alias values are compile-internal constants. ✅

### B2 — FNV-1a computed-id collisions are handled (agent HIGH → not exploitable)
`resolver.ts:264-271` hashes aliases to `computed_<hash>`; collisions are **rejected with a diagnostic** (`resolver.ts:371`, `:425`). Not a security issue. It is, however, needless complexity: relax `ComputedColumnSpec.id` regex to allow the (already regex-safe) alias directly and drop the hash (breaking change OK in alpha). KISS win + readable saved views.

### B3 — No statement timeout on user-authored queries (real DoS surface)
GQL lets authenticated users author arbitrary-shaped queries (5 joins × depth 3, formulas, grouped scans). Caps exist (rows/scan/fanout/length 20k) but **no `statement_timeout`** — a pathological-but-valid query (e.g. cross-product-ish join fanout without the preview LATERAL cap on the non-preview path, regex filter via view source) can hold a connection for a long time. Postgres regexes (saved-view `regex` op — not exposed in GQL syntax but reachable via `from view`) can be slow. **Fix:** wrap preview execution in a transaction with `SET LOCAL statement_timeout = '5s'` (or config), return a friendly timeout diagnostic.
**Status:** fixed for preview execution with transaction-scoped
`statement_timeout` and a friendly timeout diagnostic.

### B4 — Permission boundary is solid ✅
- Per-table read gates feed `readableTableIds`; sources, joins, relation outputs, joined sorts all check it (`resolver.ts:202-206`, `sql-compiler.ts:191-195`).
- View sources merge the saved source filter via `AND` (`resolver.ts:444-448`);
  WHERE applies **before** GROUP BY, so HAVING/aggregates cannot see
  filtered-out rows (verified in `group-compiler.ts:712-718`).
- Joined records re-check live-parent chain (`sql-compiler.ts:484-492`).
- UUID probing of unreadable tables/views yields "source not available" without existence leak distinction (readable-set filtering happens before matching). ✅

### B5 — Quantified limits are sane
Query ≤ 20k chars, limit ≤ 10k (preview 500), offset ≤ 10k, joins ≤ 5, depth ≤ 3, preview fanout 50, group levels ≤ 3, formula aggregate alias ≤ 50. Parser recursion is bounded by binding-power loop (no unbounded recursion observed; deep paren nesting bounded by input length — fine).

---

## C. Historical Missing Features

This section originally tracked missing GQL backend capabilities from the
2026-06-12 audit. The remaining dashboard-widget item is now closed: widgets
resolve saved view sources through the GQL parser/resolver/preview path. Current
open work is listed in the 2026-07-09 status snapshot at the top of this file.

---

## D. KISS / DRY Findings

1. **Resolver split** — fixed in the third batch: RecordQuery now checks the
   single QueryPlan resolver output.
2. **Aggregate compatibility/key drift** — fixed in the sixth batch via
   `service/aggregate-capabilities.ts` over the storage descriptor.
3. **`skip` + `offset` synonyms** — fixed: GQL keeps `offset`; `skip` is rejected.
4. **`formula()` wrapper in predicates** — fixed: `where`/`having` use direct
   expressions. `formula(...) as alias` remains the explicit syntax for computed
   select and aggregate output.
5. **In-flight rename** — fixed for the public API route: `/api/grids/gql` is
   canonical and the legacy `/query-dsl` alias is gone. The internal
   `query-dsl/` source directory can be renamed to `gql/` later for
   greppability, but it is no longer part of the public backend contract.

---

## E. Test Coverage Gaps

- Postgres GQL integration now covers 41 scenarios, including select
  label/membership, NULLS/trash, date buckets, grouped aggregate variants,
  multi-select explode, lookup/rollup computed SQL, relation joins, reverse
  joins, self-joins, scoped search, scoped formulas over joins, scoped text
  predicates over joins, grouped relation joins, exploded joined group keys,
  joined computed group keys,
  base and joined computed group keys, joined lookup/rollup row
  select/sort/formula output, direct base and joined lookup/rollup aggregates,
  aggregate-only relation joins, relation preview labels, truncation metadata,
  aggregate-only output, derived grouped/aggregate saved view sources, derived
  search/re-aggregation, derived relation-output joins with joined lookup/rollup
  select/sort, chained derived relation joins with regrouping, derived relation
  label search with raw-UUID non-match, derived select label search,
  aggregate-only system-column counts,
  joined-derived search/where/regrouping, permission-sensitive relation
  labels/search, dashboard backend consumption of view GQL sources over table
  and saved-view sources, view dashboard read/admin visibility, plus view GQL
  persistence.
- GQL route/API integration covers the public `/gql` route, removed
  `/query-dsl` alias, admin list visibility, neutral unreadable mutation
  responses, save/update canonicalization, implicit `currentSource` table/view
  contexts, derived relation search/label preview through the public route, and
  diagnostics at the transport boundary.
- Keep DB tests opt-in (`GRIDS_QUERY_DSL_DB_TEST=1`) and always run them before
  release with Postgres online. Final backend gate also runs the related
  opt-in DB suites via `GRIDS_SQL_COMPILER_DB_TEST=1`,
  `GRIDS_RECORD_SQL_FORMULA_DB_TEST=1`, and `GRIDS_NAMED_REFS_DB_TEST=1`.

---

## F. Recommended Roadmap

**P2 — cleanup before release**
1. Decide whether the internal `query-dsl` source directory should be renamed
   to `gql` for greppability.
2. Keep reference, assistant, autocomplete, and starter examples canonical only;
   the public GQL golden tests now guard copyable reference examples and removed
   alias diagnostics.
