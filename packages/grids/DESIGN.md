# Grids — Historical Design v4

Current v1 storage decisions live in [V1_DATA_MODEL.md](./V1_DATA_MODEL.md).
This file is retained as historical context and may describe tables or field
types that no longer match the implementation.

Generic Airtable-style table app for the StuVe Cloud platform.
Independent of all other apps. Postgres + JSONB only. Realistic scope: thousands to ~100k rows per table.

This is the converged design after two codex review rounds. v4 = v3 + sanity-check corrections.

## 1. Vocabulary

```
Base ─── workspace, top-level container, owns ACL + API tokens
 └─ Table
     ├─ Field (typed schema column, stable id)
     ├─ Record (JSONB row, stable id)
     ├─ View (saved filter+sort+columns config — READ-ONLY perm scope)
     └─ Form (record entry — internal users AND public, virtual default)
```

## 2. Stable-ID contract

Locked invariants — every implementation must respect:

- Field IDs are **stable, never reused**, immutable across renames
- Record IDs are **stable, never reused**, persist across soft-delete + restore
- Soft-deleted IDs **stay reserved** even after retention prune — IDs use UUIDv7 to make wraparound impossible in practice
- JSONB record data uses **field-id keys**, not field-name keys: `{ "fld_abc123": "value" }`. Renames are metadata-only.

## 3. Storage strategy

Pure JSONB, no abstraction layer. Performance scope: hundreds to ~100k rows per table comfortably.

### Indexing — what's actually built

| Index | Purpose | Scope |
|---|---|---|
| `(table_id, deleted_at, id)` composite | primary list pagination, hot path | always |
| Partial `WHERE deleted_at IS NULL` on the composite | live-row hot path | always |
| Per-field expression indexes `((data->>'fld_X')::<type>)` | filter/sort hot fields | **opt-in** per field via `field.indexed=true` |
| `pg_trgm` GIN on text fields with `indexed=true` | text-contains acceleration | **opt-in** per text/longtext field |
| `jsonb_path_ops` GIN on `data` | only for multi-select containment queries (`@>`) | **opt-in** per table when needed |

**Codex correction applied**: no broad `jsonb_ops` GIN by default. Most queries use `(data->>'fld_X')::type` casts which the default GIN doesn't accelerate. Containment-style GIN is opt-in only.

### Pagination — keyset with tuple cursor

```sql
-- ID-only sort:
WHERE id > :cursor ORDER BY id LIMIT N

-- Sorted view (e.g. by date desc, id asc as tiebreaker):
WHERE ((data->>'fld_date')::date, id) < (:cursor_value, :cursor_id)
ORDER BY (data->>'fld_date')::date DESC, id ASC LIMIT N
```

OFFSET pagination is forbidden — performance breaks at tens of thousands of rows.

## 4. Schema

```sql
-- Schema definitions (typed, indexed)
grids_bases               (id, name, description, ...)
grids_tables              (id, base_id, name, primary_field_id, position, ...)
grids_fields              (id, table_id, name, type, config jsonb, position,
                           required, default_value, indexed bool, unique_constraint bool, ...)
grids_relations           (id, source_field_id, target_table_id, type, display_field_id, backlink_field_id)
grids_views               (id, table_id, name, config jsonb, owner_user_id [null=shared], position, ...)
grids_forms               (id, table_id, name, slug, config jsonb,
                           public_token nullable, ...)            -- only NON-default forms persisted
grids_api_tokens          (id, base_id, name, scope jsonb, token_hash, ...)

-- Records (flexible)
grids_records             (id uuid, table_id, data jsonb, version int,
                           deleted_at, created_at/by, updated_at/by)
grids_record_links        (relation_id, source_record_id, target_record_id)
grids_blobs               (id, table_id, record_id, field_id, mime, size, sha256,
                           bytes bytea, created_at)
                          -- bytea, max 5MB per blob, hard quota per base

grids_audit_log           (id, base_id, table_id, record_id,
                           user_id|token_id, action, diff jsonb, created_at, ip)
grids_access              (resource_type [base|table|view], resource_id, principal, level, ...)
```

## 5. Permission model

| Resource | Levels |
|---|---|
| Base | read / write / admin |
| Table | read / write / admin |
| View | read only (visible-or-not) |

### Resolution rules (locked semantics)

- **Most-specific-wins**: view > table > base
- **No ACL row = inherit from parent**. View with no ACL inherits the table's read-permission as the visibility scope
- **Explicit `deny` row at any level overrides all parent grants** (negative permissions are explicit, not implicit)
- **Write implies read** at the same resource level
- **Admin implies write+read** at the same resource level
- **Public principal**: can be granted `read` only, never write/admin
- View-write does not exist — write authority lives at table level. Views control visibility, not mutability.

Single-query lookup:
```sql
SELECT resource_type, resource_id, level FROM grids_access
WHERE principal IN (?, 'public', :user_groups...)
AND ((resource_type='base' AND resource_id=?)
  OR (resource_type='table' AND resource_id=?)
  OR (resource_type='view' AND resource_id=?))
```
Resolve specificity in app code, cache per request.

## 6. Field types — three tiers

### Tier 1 (MVP)
text, longtext, **number (decimal-safe, optional precision/decimalPlaces/unit)**, boolean, date (date or datetime), select, id, created_at, updated_at, created_by, updated_by

### Tier 1.5 (close behind, but in their own phases)
relation, lookup, rollup, attachment (bytea), user-link, formula

### Tier 2
email, url, phone, currency, percent, duration, slug

### Tier 3
barcode/qr, isbn (with checksum), location (lat/lng + label, no radius queries), color, rich-text, json, signature

### Per-field config (locked)

- `required: bool`
- `unique: bool` — partial unique index `((data->>'fld_X')) WHERE deleted_at IS NULL`
- `default_value: any`
- `indexed: bool` — opt-in expression index
- `validation: jsonb` — type-specific (regex for text, min/max for number, etc.)

### Canonical storage rules

| Type | JSONB representation |
|---|---|
| text/longtext | string |
| number | string in canonical decimal form (`"123.45"`) — never JS number, prevents float drift. Aggregations cast to Postgres `numeric` natively: `SUM(grids.try_numeric(data->>'fld_x'))` — fast, in-DB, no JS roundtrip. JS-side `decimal.js` only at API boundary + formula evaluator. |
| boolean | true/false |
| date | ISO 8601 date string (`"2026-05-02"`) or RFC 3339 datetime (`"2026-05-02T10:00:00Z"`) |
| single-select | option-id string |
| multi-select | array of option-id strings |
| relation | empty in `data`, junction-table is the source of truth |
| attachment | empty in `data`, `grids_blobs` is the source of truth (record-id + field-id locator) |

## 7. Schema-evolution rules

### Field-dependents check (mandatory before mutate)

Before any field rename / type-change / delete, run `getFieldDependents(fieldId)` which returns refs from:
- Views (filter, sort, visibleFields)
- Forms (custom fields list)
- Other formula fields (parsed AST)
- Lookup / rollup fields (target_field_id)
- Relation display-field references
- Unique / indexed constraints on this field (must be rebuilt if type-change)

### Per-mutation rules

| Mutation | Behavior |
|---|---|
| **Rename** | Metadata-only update. Field id unchanged. No record migration. Trivial. |
| **Type-change** | Only narrow → broad allowed (text→longtext, integer-only number→decimal number, single-select→text). Wide changes (text→date, number→select) require explicit migration step with preview + per-row validation. Rebuild indexes + unique constraints atomically. Block if formula/lookup/rollup depend on this field. |
| **Delete** | Soft-delete (`deleted_at` on field row). UI hides it. JSONB keys stay in records. Auto-remove from views/forms (since views are user-savable). **Block** if any formula/lookup/rollup depends on it — user must remove dependents first. |
| **Required ON** | Validate all existing rows pass. If any row has null/empty for this field, reject toggle with row count. Validate that default-value is set OR that all forms/API-create surfaces will provide a value. |
| **Select-option delete** | If field is `required`, **block** the option-delete with the row-count using it. Otherwise cascade null on those records, audit-log the cascade. |
| **Unique toggle ON** | Check for existing duplicates first; reject if any. |

### Index lifecycle

- All indexes created with `CONCURRENTLY` (Postgres 12+) — no table lock during creation
- Failed index state (`indisvalid=false`) → background job retries, surfaces as "indexing in progress" badge in UI
- Reindex on type-change: drop old, create new concurrent, swap atomically

## 8. Filter / Sort / Aggregate

### Filter
Tree-shaped JSON, AND/OR groupable. UI: pill-builder (Phase 1B basic, Phase 2 polished) + "advanced" JSON-editor for power users. Backend: filter-tree → SQL compiler with JSONB extraction + correct casts.

Per-field-type operator set (full):
- **text/longtext**: equals, notEquals, contains, startsWith, endsWith, regex, isEmpty, isNotEmpty
- **number**: =, !=, <, <=, >, >=, between, isEmpty
- **date**: =, before, after, between, today, thisWeek, thisMonth, lastNDays, isEmpty
- **single-select**: is, isNot, isAnyOf, isNoneOf
- **multi-select**: containsAll, containsAny, doesNotContain
- **relation**: linksTo, doesNotLinkTo

### Sort
Multi-column, per-field direction (`asc`/`desc`), `nullsFirst` flag. Compiled to ORDER BY with JSONB extraction + correct cast. Tuple-cursor pagination as shown in §3.

### Aggregate
Footer per column: count, count-empty, count-unique, sum, avg, min, max, median, earliest/latest. Group-by view deferred to Phase 2.

## 9. Views

Saved JSONB config:
```jsonc
{
  "filter": { /* tree */ },
  "sort": [{ "fieldId": "fld_X", "direction": "desc", "nullsFirst": false }],
  "visibleFields": ["fld_X", "fld_Y"],
  "fieldOrder": ["fld_X", "fld_Y"],
  "fieldWidths": { "fld_X": 150 },
  "groupBy": null,
  "rowHeight": "compact" | "default" | "tall"
}
```

Personal (owner_user_id set) or shared (null). ACL row optional — if absent, inherits table-read.

**MVP: only table view.** Calendar/Gallery/Kanban deferred to later phase, will reuse Spaces patterns.

## 10. Forms — virtual default

### Custom forms (persisted)
Stored in `grids_forms`, JSONB config:
```jsonc
{
  "title": "...", "description": "...",
  "fields": [{ "fieldId": "fld_X", "label": "...", "helpText": "...",
               "required": true, "defaultValue": null }],
  "submitLabel": "Save", "successMessage": "Saved",
  "redirectUrl": null, "isPublic": false, "publicToken": null
}
```

### Default form per table — VIRTUAL, not persisted
**Codex correction**: don't persist a default form config. Derive on-the-fly from current field set:
- All non-system fields, in `position` order
- Excluded automatically: `id, formula, lookup, rollup, created_at/by, updated_at/by`
- Required from field-config carries over
- Default-value from field-config carries over
- When a field is added/removed/renamed, the default form auto-updates without action
- User can clone the default → creates a custom form. Clone takes the current snapshot.

UI surfaces it as "Quick Add" — never deletable, only collapsible/hidden.

### Public forms
Token-based URL `/forms/<publicToken>`. Anonymous, captcha + rate-limited. Stricter allowed-field rules: relations and attachments require explicit allow per field. System fields auto-set (created_by = null or "anonymous" placeholder).

## 11. Audit log + soft-delete + restore

### Audit log structure
```ts
{
  baseId, tableId, recordId,
  userId | tokenId,           // anonymous public-form submission = null
  timestamp, ip, userAgent,
  action: "created" | "updated" | "deleted" | "restored" | "imported",
  diff: { fieldId: { old, new } } | null,
  schemaVersion: int,         // snapshot of field-config-version at write time
}
```

### Restore semantics — explicit, not audit-replay
- "Restore from trash" = `UPDATE grids_records SET deleted_at = NULL WHERE id = ?`
- Audit log records the restore event but is **not the source of truth** for the data — the row itself is
- If a record was hard-deleted (e.g. retention prune), it's **gone** — audit-log diffs are not replayable to reconstruct it
- This is a deliberate KISS choice: we're not building a snapshot/version store

### Optimistic locking
- `records.version int` increments atomically on every UPDATE
- Mutation API requires `If-Match: <version>` header (or implicit via API params)
- Conflict response: `409 Conflict` with current version + diff hint
- Audit log captures the version at the time of write

### Bulk-delete / bulk-import (later)
- One audit entry per batch with count and a manifest reference
- Per-record audit not needed for bulk ops

## 12. Formula engine — JS-only, display-only

**Codex correction applied**: cut function library, scope as "display formulas" not "queryable formulas".

### Phase 5 scope (when we get there)
- Hand-written Pratt parser → AST
- Type inference at save-time, reject invalid compositions
- Cycle detection at save-time
- Evaluator: JS, computed at query time, **only for visible page rows**
- **No filter-by-formula, no sort-by-formula** in Phase 5
- **No relation aggregates** in Phase 5 (deferred to a later formula phase, requires stable rollup field first)

### Function library — Phase 5 cut

| Group | Functions |
|---|---|
| Math | `+ - * / %`, `ABS, ROUND, FLOOR, CEIL, MIN, MAX` |
| Text | `CONCAT, LEN, LOWER, UPPER, TRIM` |
| Logic | `IF, AND, OR, NOT, ISBLANK` |
| Date | `TODAY, NOW, DATEADD, DATEDIFF, YEAR, MONTH, DAY` |

**Deferred to later formula phase**: regex, slicing (LEFT/RIGHT/MID/FIND), SWITCH, type cast, relation aggregates (SUM over relation), DATETIME_PARSE/FORMAT, IS_BEFORE/AFTER, etc.

### Semantic rules (locked day 1)

- **null propagation**: any operation involving null returns null (Excel-style)
- **division-by-zero**: returns ERROR sentinel, displayed as `#DIV/0`
- **regex flavor**: JS regex only (when introduced)
- **timezone**: all date ops in user's timezone (from settings)
- **number precision**: formulas preserve precision for numeric strings via decimal.js — no JS-number arithmetic on money

### Phase 6+ (later)
- SQL compilation for arithmetic + simple text/date subset → unlocks filter-by-formula
- Materialized columns for hot formulas
- Full function library

## 13. Export (no import in MVP)

- CSV / Excel / JSON streaming export
- Respects current view (filter + sort + visible-fields)
- Token-driven export endpoint for automation
- Streaming response for large tables (chunked CSV with header row)
- Number/date canonical: ISO 8601 dates, numbers as decimal strings with `.` separator

## 14. CMS / API

Historical note: this section predates Cloud's shared service-account API-key
model. Current implementations must use `cld_<prefix>_<secret>` credentials
and resource-bound Cloud service accounts, not app-local token formats.

```
GET    /api/grids/<baseId>/<tableId>/records?filter=&sort=&page=
GET    /api/grids/<baseId>/<tableId>/records/:id
POST   /api/grids/<baseId>/<tableId>/records
PATCH  /api/grids/<baseId>/<tableId>/records/:id
DELETE /api/grids/<baseId>/<tableId>/records/:id
GET    /api/grids/<baseId>/<tableId>/views/<viewId>/records  -- baked filter
GET    /api/grids/<baseId>/<tableId>/blobs/:blobId
```

API tokens: use Cloud resource-bound service accounts and `Authorization: Bearer cld_<prefix>_<secret>`.

OpenAPI spec auto-generated per base — emitted from grids, consumed by api-docs. Grids itself stays independent (just exports the spec).

Public-read views: ACL-row with `principal=public, resource_type=view, level=read` → no token needed for `GET /views/<id>/records`. Blog use-case unlocked.

## 15. Hard limits (locked, configurable per Cloud-operator)

| Limit | Default |
|---|---|
| Max fields per table | 200 |
| Max row JSON size (data column) | 1 MB |
| Max select-options per field | 500 |
| Max views per table | 50 |
| Max forms per table | 50 |
| Max blob size | 5 MB |
| Max blobs per record-field | 10 |
| Max records per table (soft warning) | 500,000 (warns user, doesn't block) |
| Max API tokens per base | 20 |

Enforced at validation boundary. Rejected with helpful error messages including the limit + current count.

## 16. Phase plan — Phase 1 split per codex

| Phase | Scope |
|---|---|
| **1A — Data Core** | Bases, Tables, Fields (text/longtext/number/boolean/date/select/id/timestamps), Records (JSONB + composite + partial indexes), validation+default+required, optimistic-lock via `version`, soft-delete, audit log, schema-evolution rules + `getFieldDependents()`, hard-limits enforcement |
| **1B — Query Core** | Keyset pagination (with tuple-cursor for sorted), Filter-JSON-Compiler, Sort-Compiler, Aggregate-Compiler (footer aggregates), opt-in expression index lifecycle (CONCURRENTLY + retry), trgm indexes |
| **1C — Product Shell** | Table-UI (read + edit + create), ACL UI (base + table + view), Schema-Evolution UI (add/rename/type-change/delete with dependents-warning), Restore-from-trash UI, basic permission resolver |
| **2 — Power-Filter** | Pill-builder UI, JSON-advanced-mode editor, multi-sort UI, view ACL public/personal/shared, view-create/edit UI |
| **3 — Forms + API** | Internal forms, public forms, virtual default form, resource-bound API keys, OpenAPI spec emission, public-read views |
| **4 — Relations** | Relation field, junction-table CRUD, lookup, rollup, batch-fetch in record-list pipeline |
| **5 — Formula** | Pratt parser + AST + JS evaluator (display-only, visible-rows only), cycle detection, type inference, scoped function library |
| **6 — Tier-2 fields** | currency, email, url, phone, percent, duration, slug, attachment (bytea + grids_blobs), user-link |
| **7 — Tier-3 fields** | barcode, isbn, location, color, rich-text, json, signature |
| **8 — Export** | CSV / Excel / JSON streaming, view-aware, number/date canonical |
| **9 — Polish** | Bulk-edit, group-by view, field-level perms, audit-log UI, formula function-library expansion |
| **10 — Later** | Bulk-import, calendar/gallery/kanban views, SQL-compiled formulas, snapshots, S3-backed blobs, formula-filter/sort, relation aggregates in formulas |

## 17. Locked decisions (no more debate)

| # | Decision |
|---|---|
| Naming | `grids` (package), "Bases / Tabellen / Ansichten" (UI-German) |
| Storage | JSONB only, no abstraction layer |
| View permissions | read-only (no view-write) |
| GIN | not by default — opt-in only for multi-select containment |
| Computed fields | on-read |
| Formula scope | JS-only, display-only, scoped function library |
| Blobs | bytea, 5MB cap, in-Postgres |
| Versioning | `version int` + audit log diff, no snapshot table |
| Restore | `deleted_at = null`, never audit-replay |
| API tokens | per-base |
| Realtime | no |
| Performance target | hundreds to ~100k rows per table comfortably |
| Import | not in MVP |
| Export | yes, view-aware, streaming |
| Field types | all 3 tiers + ISBN |
| Forms | virtual default + custom + public |
| Field IDs | stable, never reused |
| Pagination | keyset with tuple-cursor for sorted views, OFFSET forbidden |
| Hard limits | enforced, configurable by Cloud-operator |

## 18. Pre-implementation checklist — DONE

- [x] `getFieldDependents(fieldId)` signature locked: returns `FieldDependent[]` with `{type, resourceId, resourceName, context?, blocking}`
- [x] Filter-tree Zod-schema sketched (rekursiv via `z.lazy`)
- [x] Field-validation-config Zod-schemas per type (in `contracts/field-validation.ts`)
- [x] Canonical storage rules locked per type (number + date especially)
- [x] **UUIDv7** for `grids_records.id` via `Bun.randomUUIDv7()`, **UUIDv4** for schema entities (bases/tables/fields/views/forms) via `crypto.randomUUID()`
- [x] Hono route shapes sketched for Phase 1A (REST under `/api/grids/`)
- [x] Formula parser location: `packages/grids/src/formula/` (parser/validator/evaluator/functions/types/index)
- [x] Decimal lib: **`decimal.js`** as local dep in `packages/grids/package.json` (move to cloud package later if other apps need it)

## 19. Tests (added per user request)

`bun test` built-in, co-located `*.test.ts` next to source. Pure-logic modules have unit tests; DB integration is separate (slower, deferred).

### Test targets per phase

| Phase | Test targets |
|---|---|
| 1A | Field-type validation/normalization (text, number, date, boolean, single-select, multi-select, rating), `getFieldDependents()` |
| 1B | Filter-tree → SQL compiler (snapshot tests for SQL output), sort compiler, tuple-cursor pagination math |
| 1C | Permission resolver (most-specific-wins, explicit-deny override, write-implies-read, public scope) |
| 5 | **Formula engine — primary test focus**: parser (input → AST snapshots), validator (cycle detection, type inference), evaluator (AST + record-ctx → result), null-propagation, division-by-zero, number-precision in formulas |
| 6/7 | Tier-2/3 field-type validation/normalization |
| 8 | Export-format compiler (record → CSV row, escaping edge cases, number canonical form) |

### Out of scope for unit tests (KISS)

- Database integration (separate integration tests, deferred)
- Hono route handlers (thin wrappers, no own logic)
- UI components (manual smoke-testing for SolidJS islands)

### Co-location convention

```
packages/grids/src/
├── formula/
│   ├── parser.ts
│   ├── parser.test.ts
│   ├── evaluator.ts
│   ├── evaluator.test.ts
│   ├── validator.ts
│   └── validator.test.ts
├── filter/
│   ├── compiler.ts
│   └── compiler.test.ts
└── service/
    ├── field-dependents.ts
    ├── field-dependents.test.ts
    ├── permission-resolver.ts
    └── permission-resolver.test.ts
```

`bun test packages/grids/` runs everything in sub-second. CI gate: tests must pass before any merge that touches grids.
