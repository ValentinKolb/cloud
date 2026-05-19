# Grids V1 Backend Invariants

This document is the short audit map for the production-readiness pass.
SQL remains the source of truth; service validators only reject impossible
writes before they can become persisted broken state.

## Storage

- Bases, tables, fields, records, views, forms, dashboards, files, and
  relation links are ordinary Postgres rows.
- Record cell data lives in `grids.records.data` keyed by field UUID.
- Relation values live in `grids.record_links`, not in record JSON.
- File values live in `grids.files` as `bytea`, not in record JSON.
- Hard deletes rely on FK `ON DELETE CASCADE`; soft deletes make rows
  unreachable until the maintenance purge removes them.

## Liveness

- Child reads join their live parent chain. A trashed base hides its
  tables, and a trashed table hides its fields, records, forms, and views.
- Restore is top-down. A child cannot be restored while its parent is
  trashed.
- Public forms also require live form, table, and base rows.

## Query Contract

- `ViewQuery` is the canonical query shape for saved views, table reads,
  dashboards, and exports.
- Saved views are validated against live fields before insert/update:
  filters, search scopes, sort, groupBy, groupSort, aggregations, and
  columns must compile for the target table.
- `groupSort` only makes sense with `groupBy`; orphaned `groupSort` is
  rejected instead of being silently ignored.
- Deleting a field strips stale non-blocking refs from forms and saved
  view queries, including `groupSort`.

## Dashboard/Form Contracts

- Dashboard widgets may only reference live tables, views, and forms in
  the dashboard's own base.
- Stat widgets validate their source filters, aggregations, derived
  operands, and trend date field before save.
- Forms may only reference live fields from their table, each field at
  most once, and stored defaults/form-values must validate against the
  field handler.

## Permission Boundary

- API handlers perform permission checks. Services enforce structural
  invariants and liveness.
- Dashboard and view visibility use resource-level ACL overrides on top
  of owner/shared defaults.
- Record relation expansion is resolved server-side with viewer context,
  so clients do not need N+1 expansion calls.

## Non-Goals

- No JS-side correctness cache.
- No backward compatibility for alpha-era Grids schema drift.
- No cross-base references in saved Grids configuration.
