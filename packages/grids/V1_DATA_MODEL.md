# Grids v1 Data Model Contract

This is the v1 storage contract for Grids. It favors a small schema,
Postgres as the source of truth, and predictable behavior at a few hundred
thousand records per installation.

## Non-negotiables

- Postgres is the source of truth. No process-local cache may be required for
  correctness.
- The `grids` schema may be reset in local development, but the shared
  database must not be dropped.
- UUID primary keys are internal and stable. Short ids are URL/formula handles,
  not foreign keys.
- Record values live in `grids.records.data` as JSONB keyed by field UUID.
- Relation values live in `grids.record_links`, never as source-of-truth JSONB.
- Audit log is history. Current system values such as `created_by` and
  `updated_by` stay on the record row for cheap filtering/display.

## Core Tables

- `bases`: top-level Grids workspace.
- `tables`: schema containers inside a base.
- `fields`: typed metadata for JSONB record values.
- `records`: one row per record; user field values in `data`.
- `record_links`: relation-field junction table.
- `files`: small file blobs for `file` fields, stored as `bytea` and
  cascade-bound to records and fields.
- `views`: saved query JSON, validated by the service layer.
- `forms`: saved form config JSON, validated by the service layer.
- `dashboards`: saved layout config JSON, validated by the service layer.
- `audit_log`: append-only operational history.

## Field Storage

The field descriptor layer is the single source of truth for SQL projection,
formatting, and capability flags. Filter, sort, group, aggregate, search, and
index code should not re-spell type-specific storage rules independently.

V1 field-type consolidation:

- `text`: plain string with optional validation/preset config for email, url,
  phone, isbn, barcode, slug, and similar text-shaped values.
- `longtext`: plain string. Markdown-capable by convention; export may emit raw
  Markdown or sanitized rendered HTML.
- `number`: canonical decimal string with optional precision, decimalPlaces,
  unit/symbol, and format config. This absorbs decimal/currency/money. The unit
  lives in config; there are no separate decimal or currency field types.
- `percent`: kept because it has a distinct range contract and percent display.
- `duration`: kept because it accepts HH:MM:SS/MM:SS input and stores seconds.
- `boolean`, `date`, `select`, `json`, `relation`, `file`, `formula`, `lookup`,
  `rollup`, `id`, and system fields remain
  because their write/read/query behavior is materially distinct.

File field values do not live in `records.data`. `grids.files` is the source of
truth for metadata and bytes. The default per-file cap is 10 MB via
`grids.max_file_size_mb`; the service enforces it at upload time.

## Data Contract vs UX Sugar

Grids v1 should keep the stored model as small as possible and put convenience
workflows on top of that model. A feature belongs in the backend/data contract
when it affects correctness, permissions, querying, export, automation, or
performance. A feature belongs in the frontend when it is only a better way to
fill the same backend config.

Backend/data contract examples:

- Relation links and relation expansion. Relations must be backed by
  `record_links` and page-level batch reads so record rendering never requires
  one request per relation cell.
- Lookup and rollup values. These should be SQL projections over
  `record_links`, not JS-side aggregation after fetching.
- Search, filter, sort, group, aggregate, export, and dashboard data sources.
  These are canonical query concerns and should flow through `ViewQuery` or a
  closely related validated service contract.
- Formula expressions, dependency ordering, and cycle detection. The editor can
  help users author formulas, but execution and errors are service concerns.
- Automation triggers, retry/delivery state, and idempotency. The UI can provide
  a builder, but scheduling correctness cannot depend on a browser or an app
  process-local cache.
- File bytes, metadata, size limits, accept rules, and cascade ownership.

Frontend/UX sugar examples:

- Text format badges such as Email, URL, Phone, Slug, or ISBN. They only fill
  `text.config.regex`; there is no persisted `config.preset` and no separate
  field type.
- File accept badges such as Photos, PDF, Spreadsheets, or Archives. They only
  append MIME types/extensions to `file.config.accept`.
- Export modal controls such as delimiter pickers, field checkboxes, and output
  labels. The modal builds an explicit server-side export spec.
- Formula field pickers, autocomplete, and friendlier error text. These improve
  authoring without changing the formula execution model.
- Markdown toolbars or preview panes for `longtext`. The stored value remains a
  plain string; export/render options decide whether it is emitted as Markdown,
  plain text, or sanitized HTML.

When in doubt, add the smallest backend primitive that makes the operation
correct and queryable, then keep presets, badges, modals, and shortcuts as
replaceable UI layers.

## Index Contract

Always-on indexes cover structural hot paths: listing live children by parent,
record list pagination by table, trash lookup, access junctions, and relation
forward/reverse lookup.

Per-field indexes are opt-in and must be:

- scoped to the owning table,
- partial to live records that actually contain the JSONB field key,
- built concurrently outside write transactions,
- generated from the same storage contract used by query compilers.

Broad JSONB indexes are not part of v1 by default. Add them only from measured
soak-test evidence.

## Soft Delete

Soft delete is explicit current state, not audit replay. Restore is an update
of the row tombstone. Audit entries record what happened, but are not used to
reconstruct current data.

## Migration Direction

The v1 migration should become clean DDL for the desired schema. Legacy
rename/backfill/type-collapse paths are allowed while the local schema still
contains old data, but they should not define the long-term shape.
