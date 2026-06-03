# Grids V1 Query Audit

Date: 2026-05-12

Scope: SQL hot paths and `ViewQuery` semantics inside `packages/grids`.

## TLDR

- `records.data` stays the source of truth for scalar fields; relations stay in `grids.record_links`; files stay in `grids.files`.
- Field indexes are opt-in and now planner-usable for the normal query shape: partial by `table_id + deleted_at`, not by `data ? fieldId`.
- `ViewQuery.search` is now real saved-view state across SSR, client refetch, export, and dashboards.
- Grouped queries now reject unsupported aggregations instead of silently dropping them.
- Grouped queries can sort buckets by aggregate values through `groupSort`, which enables Top-N views.
- Multi-select grouping uses SQL explode semantics, so tag-style stats work without JS aggregation.
- Dashboard stat sources can compute simple derived metrics from two filtered aggregate operands.
- `limit` remains a backend/export cap. It is not exposed in the view editor for V1 because there is no current UX need for editable top-N views.

## SQL Hot Paths

100k-row isolated soak dataset, local Postgres, after `ANALYZE grids.records`.

| Query | Old plan | Old time | New plan | New time |
| --- | --- | ---: | --- | ---: |
| `amount >= 900` sorted by amount | seq scan | 103ms | bitmap index scan on amount | 13ms |
| `title ILIKE '%needle%'` | parallel seq scan | 23ms | trigram bitmap index scan | 3ms |
| `sum(amount) where category='active'` | seq scan | 50ms | bitmap index scan on category | 45ms |
| `group by category count+avg` | seq scan + sort | 184ms | category index scan | 166ms |

Full service-level soak after the code change, with `ANALYZE grids.records` after the bulk seed:

| Operation | Time |
| --- | ---: |
| seed 100k rows | 9190ms |
| analyze records | 414ms |
| list `amount >= 900` sorted | 20ms |
| search `needle` | 8ms |
| aggregate sum where category active | 39ms |
| group category count+avg | 122ms |
| export first 1000 CSV rows | 119ms |

The important fix is not adding more indexes. It is making the existing opt-in indexes match the predicates the compilers actually emit. The previous partial predicate included `data ? fieldId`; list/search/group/aggregate do not add that predicate, so Postgres could not use the index safely.

Expected behavior:

- High-selectivity filters/search should use opt-in expression/trigram indexes.
- Low-selectivity aggregate/group scans may still scan many rows. That is acceptable for hundreds of thousands of rows.
- No JS-side cache is needed for query correctness.

## ViewQuery Matrix

| Field | Records page SSR | Client refetch | Table query API | Export | Dashboard saved view |
| --- | --- | --- | --- | --- | --- |
| `filter` | yes | yes | yes | yes | yes |
| `search` | yes | yes | yes | yes | yes |
| `sort` | yes | yes | yes | yes | embedded view yes |
| `groupBy` | grouped mode | grouped mode | grouped mode | not exported as groups | chart/view-stats yes |
| `groupSort` | grouped mode | grouped mode | grouped mode | not exported as groups | chart/view-stats yes |
| `aggregations` | footer/group columns | footer/group columns | footer/group columns | not exported as aggregate rows | chart/view-stats yes |
| `columns` | table columns + computed display columns | table columns + computed display columns | field columns ignored by data API; computed columns evaluated after records load | default export fields | embedded view + view-stats |
| `includeDeleted` | yes | yes | yes | yes | saved-view widgets yes |
| `limit` | backend/export cap | backend/export cap | page cap | export max rows | chart widget has own bucket cap |

## V1 Boundaries

- Search clear-state for saved views is represented by `?q=`. Missing `q` means inherit the saved view search.
- Aggregate-sorted group queries are Top-N oriented. Cursor pagination is intentionally disabled for them because a correct cursor would need aggregate values in the token.
- Multi-select grouping is explode-mode: one record can contribute to multiple buckets.
- Group mode supports `count`, `countEmpty`, `countUnique`, `sum`, `avg`, `min`, `max`. `median`, `earliest`, and `latest` stay flat-aggregate only.
- Dashboard raw-table widgets intentionally do not use `ViewQuery`; only saved-view widgets do.
- Derived dashboard stats support `ratio`, `percent`, `difference`, `sum`, and `product` over two aggregate operands. Each operand can have its own filter.
- `columns.format` affects table rendering/export formatting where supported. View-stats uses field/aggregate-level format inference for now.
- Computed view columns are display columns. They can reference the visible record's fields and are evaluated after the SQL record query returns. They are not filter, sort, search, group, or aggregate sources in v1.
