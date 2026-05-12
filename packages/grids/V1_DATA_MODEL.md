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

Recommended v1 consolidation:

- `text`: plain string with optional validation/preset config for email, url,
  phone, isbn, barcode, slug, and similar text-shaped values.
- `longtext`: plain string. Markdown-capable by convention; export may emit raw
  Markdown or sanitized rendered HTML.
- `decimal`: canonical decimal string with optional unit/symbol/format config.
  This should absorb currency and likely percent/duration unless a distinct
  input UX clearly earns the extra type.
- `boolean`, `date`, `single-select`, `multi-select`, `json`, `relation`,
  `file`, `formula`, `lookup`, `rollup`, `autonumber`, and system fields remain
  only if their behavior is materially distinct.

File field values do not live in `records.data`. `grids.files` is the source of
truth for metadata and bytes. The default per-file cap is 10 MB via
`grids.max_file_size_mb`; the service enforces it at upload time.

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
