import { sql } from "bun";
import { crypto } from "@valentinkolb/stdlib";

/**
 * Schema for the Grids app: bases → tables → (fields, records, views, forms).
 *
 * Storage strategy: records use JSONB keyed by stable field IDs. Per-field
 * expression indexes are opt-in (`fields.indexed=true`). No GIN on `data` by
 * default — ad-hoc filter performance is the user's call when they enable
 * indexing per field.
 *
 * Permission model: base → table → view, with `auth.access` junction tables.
 * View ACL grants `read` only; write/admin authority always lives at table+.
 */
export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS grids`.simple();
  console.log("  ✓ grids schema");

  // ──────────────────────────────────────────────────────────────────
  // Safe-cast helpers (Slice 7 bug fix)
  // ──────────────────────────────────────────────────────────────────
  // Pre-v3 the filter and sort compilers cast JSONB text values directly
  // (e.g. `(data->>fid)::numeric`). A single corrupt record (typo,
  // schema-drift, manual SQL fixup) crashed the entire query — every
  // user of that table got 500s until somebody fixed the offending row.
  //
  // These wrappers return NULL on parse failure instead of raising.
  // The compilers route every cast through them, so bad data simply
  // doesn't match the filter / sorts to NULL instead of breaking the page.
  await sql`
    CREATE OR REPLACE FUNCTION grids.try_numeric(t text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE STRICT AS $$
    BEGIN RETURN t::numeric; EXCEPTION WHEN others THEN RETURN NULL; END $$
  `.simple();
  // Date / timestamptz parsing depends on session DateStyle and TimeZone,
  // so technically these are STABLE not IMMUTABLE — using IMMUTABLE could
  // poison constant-folded prepared plans across sessions. STABLE is the
  // honest annotation; cost is the same for per-row scans.
  await sql`
    CREATE OR REPLACE FUNCTION grids.try_date(t text) RETURNS date
    LANGUAGE plpgsql STABLE STRICT AS $$
    BEGIN RETURN t::date; EXCEPTION WHEN others THEN RETURN NULL; END $$
  `.simple();
  await sql`
    CREATE OR REPLACE FUNCTION grids.try_timestamptz(t text) RETURNS timestamptz
    LANGUAGE plpgsql STABLE STRICT AS $$
    BEGIN RETURN t::timestamptz; EXCEPTION WHEN others THEN RETURN NULL; END $$
  `.simple();
  await sql`
    CREATE OR REPLACE FUNCTION grids.try_boolean(t text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT AS $$
    BEGIN RETURN t::boolean; EXCEPTION WHEN others THEN RETURN NULL; END $$
  `.simple();
  console.log("  ✓ grids.try_* safe-cast helpers");

  // ──────────────────────────────────────────────────────────────────
  // bases
  // ──────────────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS grids.bases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  // v3: soft-delete consistency. Idempotent for pre-existing DBs.
  await sql`ALTER TABLE grids.bases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`.simple();
  console.log("  ✓ grids.bases");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.base_access (
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (base_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_base_access_access ON grids.base_access(access_id)`.simple();
  console.log("  ✓ grids.base_access");

  // ──────────────────────────────────────────────────────────────────
  // tables
  // ──────────────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS grids.tables (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      primary_field_id UUID,
      position INT NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`ALTER TABLE grids.tables ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`.simple();
  // Hot-path index: list live tables of a base in order.
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_tables_base_live ON grids.tables(base_id, position) WHERE deleted_at IS NULL`.simple();
  // Drop the old non-partial index if it exists (keeps the index name
  // stable across migrations rather than letting both versions coexist).
  await sql`DROP INDEX IF EXISTS grids.idx_grids_tables_base`.simple();
  console.log("  ✓ grids.tables");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.table_access (
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (table_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_table_access_access ON grids.table_access(access_id)`.simple();
  console.log("  ✓ grids.table_access");

  // ──────────────────────────────────────────────────────────────────
  // fields
  // ──────────────────────────────────────────────────────────────────
  // `type` is a free TEXT (not enum) so we can introduce new field types
  // without DDL. The application layer rejects unknown types at write time.
  // `config` carries type-specific validation (regex/min/max/options/etc).
  await sql`
    CREATE TABLE IF NOT EXISTS grids.fields (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INT NOT NULL DEFAULT 0,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      default_value JSONB,
      indexed BOOLEAN NOT NULL DEFAULT FALSE,
      unique_constraint BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  // Description is a top-level field-level metadata, not a type-specific
  // config knob. Idempotent ALTER for any DB that pre-dates this column.
  await sql`ALTER TABLE grids.fields ADD COLUMN IF NOT EXISTS description TEXT`.simple();
  // Presentable: include this field in the auto-generated label when
  // the record is referenced elsewhere (relation cells, picker results).
  // Hide-in-table: column hidden from the default records grid; still
  // shown in the detail panel. Both default to false.
  await sql`ALTER TABLE grids.fields ADD COLUMN IF NOT EXISTS presentable BOOLEAN NOT NULL DEFAULT FALSE`.simple();
  await sql`ALTER TABLE grids.fields ADD COLUMN IF NOT EXISTS hide_in_table BOOLEAN NOT NULL DEFAULT FALSE`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_fields_table ON grids.fields(table_id, position) WHERE deleted_at IS NULL`.simple();
  console.log("  ✓ grids.fields");

  // ──────────────────────────────────────────────────────────────────
  // records (JSONB-keyed by field ID)
  // ──────────────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS grids.records (
      id UUID PRIMARY KEY,
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      version INT NOT NULL DEFAULT 1,
      deleted_at TIMESTAMPTZ,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  // Composite index for the hot path: list live rows of a table in id order.
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_records_table_live ON grids.records(table_id, id) WHERE deleted_at IS NULL`.simple();
  // Trash queries: list soft-deleted rows of a table (ordered by deletion time).
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_records_table_trash ON grids.records(table_id, deleted_at) WHERE deleted_at IS NOT NULL`.simple();
  console.log("  ✓ grids.records");

  // ──────────────────────────────────────────────────────────────────
  // files — small per-record blobs stored directly in Postgres
  // ──────────────────────────────────────────────────────────────────
  // File field values do not live in records.data. The blob table is the
  // source of truth and cascades from records/fields, so hard-pruning a
  // record/table/base or removing a file field lets Postgres clean up bytes.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      record_id UUID NOT NULL REFERENCES grids.records(id) ON DELETE CASCADE,
      field_id UUID NOT NULL REFERENCES grids.fields(id) ON DELETE CASCADE,
      position INT NOT NULL DEFAULT 0,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INT NOT NULL CHECK (size_bytes >= 0),
      sha256 TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (octet_length(bytes) = size_bytes)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_files_record_field
    ON grids.files(record_id, field_id, position, created_at)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_files_field
    ON grids.files(field_id)
  `.simple();
  console.log("  ✓ grids.files");

  // ──────────────────────────────────────────────────────────────────
  // record_links — junction table for relation fields
  // ──────────────────────────────────────────────────────────────────
  // v3 replaces the previous "JSONB-array of UUIDs in data->>fieldId"
  // storage with a real junction table. Wins:
  //  - real foreign keys + ON DELETE CASCADE (no zombie links to deleted records)
  //  - reverse-lookup (`which records link to X?`) is an index scan, not a JSONB seq scan
  //  - lookup/rollup become real SQL JOINs instead of read-time enrichment (Slice 4)
  //  - group-by on relations works via standard GROUP BY (Slice 8)
  //
  // `position` preserves user-ordered cardinality:multiple — the order
  // matters in the UI ("first link is the primary one") and we want it
  // to round-trip through writes.
  //
  // No backwards-compat with the old JSONB storage: existing relation
  // values in `records.data` are ignored on read once Slice 3 lands.
  // Clear them out manually on the local DB if you need a clean slate.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.record_links (
      from_record_id UUID NOT NULL REFERENCES grids.records(id) ON DELETE CASCADE,
      from_field_id  UUID NOT NULL REFERENCES grids.fields(id)  ON DELETE CASCADE,
      to_record_id   UUID NOT NULL REFERENCES grids.records(id) ON DELETE CASCADE,
      position       INT NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_record_id, from_field_id, to_record_id)
    )
  `.simple();
  // Forward read: "all targets of (record, field)" — used on every record fetch.
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_record_links_forward ON grids.record_links(from_field_id, from_record_id, position)`.simple();
  // Reverse read: "all records linking to X via field F" — used by
  // back-references and future "incoming relations" UI.
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_record_links_reverse ON grids.record_links(to_record_id, from_field_id)`.simple();
  console.log("  ✓ grids.record_links");

  // ──────────────────────────────────────────────────────────────────
  // views
  // ──────────────────────────────────────────────────────────────────
  // owner_user_id NULL = shared (visible to anyone with table-read).
  // `query` carries the canonical ViewQuery JSON (filter/sort/columns/
  // groupBy/aggregations/limit). v3 renamed from `config` → `query` to
  // match the canonical concept name in contracts.ts.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      query JSONB NOT NULL DEFAULT '{}'::jsonb,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      position INT NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`ALTER TABLE grids.views ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`.simple();
  // v3 rename: `config` → `query`. Idempotent — runs once on existing
  // databases that still have the old column name. Drops the legacy
  // column after copy because no code reads `config` anymore.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'grids' AND table_name = 'views'
          AND column_name = 'config'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'grids' AND table_name = 'views'
          AND column_name = 'query'
      ) THEN
        ALTER TABLE grids.views RENAME COLUMN config TO query;
      END IF;
    END $$;
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_views_table_live ON grids.views(table_id, position) WHERE deleted_at IS NULL`.simple();
  await sql`DROP INDEX IF EXISTS grids.idx_grids_views_table`.simple();
  console.log("  ✓ grids.views");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.view_access (
      view_id UUID NOT NULL REFERENCES grids.views(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (view_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_view_access_access ON grids.view_access(access_id)`.simple();
  console.log("  ✓ grids.view_access");

  // ──────────────────────────────────────────────────────────────────
  // forms — record-entry surface for internal users + optional public URLs
  // ──────────────────────────────────────────────────────────────────
  // The "default form" per table is virtual (computed from active fields)
  // and not stored here. Only user-customized forms live in grids.forms.
  // Public forms have a non-null `public_token` that anonymous callers
  // pass in the URL.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.forms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      field_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
      public_token TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      position INT NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`ALTER TABLE grids.forms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`.simple();
  // v3 Slice 6: frozen Field[] copy taken at form-create — submit
  // validates against this rather than live `grids.fields`, so editing
  // a field after publishing a form doesn't silently mutate behavior.
  await sql`ALTER TABLE grids.forms ADD COLUMN IF NOT EXISTS field_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_forms_table_live ON grids.forms(table_id, position) WHERE deleted_at IS NULL`.simple();
  await sql`DROP INDEX IF EXISTS grids.idx_grids_forms_table`.simple();
  // Public-token lookup is the public form's hot path; partial index keeps
  // it scoped to forms that are actually public AND alive.
  await sql`DROP INDEX IF EXISTS grids.idx_grids_forms_public_token`.simple();
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_forms_public_token ON grids.forms(public_token) WHERE public_token IS NOT NULL AND deleted_at IS NULL`.simple();
  console.log("  ✓ grids.forms");

  // form_access — same junction shape as base_access / table_access /
  // view_access. Form ACLs only carry `write` (= "can submit this form
  // even when it has no public token"); the API rejects read/admin
  // grants because they don't map to anything useful — read is implied
  // by being granted any form access (the user needs to render the
  // form schema), admin == form CRUD which lives at table-admin.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.form_access (
      form_id UUID NOT NULL REFERENCES grids.forms(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (form_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_form_access_access ON grids.form_access(access_id)`.simple();
  console.log("  ✓ grids.form_access");

  // ──────────────────────────────────────────────────────────────────
  // audit log
  // ──────────────────────────────────────────────────────────────────
  // No FK on record_id: records are soft-deletable and may be hard-pruned
  // later, but the audit history must survive.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID,
      table_id UUID,
      record_id UUID,
      user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      diff JSONB,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_audit_record ON grids.audit_log(record_id, created_at DESC) WHERE record_id IS NOT NULL`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_audit_table ON grids.audit_log(table_id, created_at DESC) WHERE table_id IS NOT NULL`.simple();
  console.log("  ✓ grids.audit_log");

  // ──────────────────────────────────────────────────────────────────
  // deprecated-type cleanup
  // ──────────────────────────────────────────────────────────────────
  // 4 field types had no honest input UX — collapse them onto their
  // closest surviving cousin so existing rows continue to render. The
  // stored cell values stay as-is in `data` (text payload survives in a
  // text column; signature data: URLs survive in longtext; locations
  // become opaque json). UPDATE only flips the type label.
  await sql`UPDATE grids.fields SET type = 'text', config = '{}'::jsonb WHERE type = 'color'`.simple();
  await sql`UPDATE grids.fields SET type = 'longtext', config = '{}'::jsonb WHERE type = 'rich-text'`.simple();
  await sql`UPDATE grids.fields SET type = 'longtext', config = '{}'::jsonb WHERE type = 'signature'`.simple();
  await sql`UPDATE grids.fields SET type = 'json', config = '{}'::jsonb WHERE type = 'location'`.simple();
  console.log("  ✓ deprecated field types collapsed");

  // ──────────────────────────────────────────────────────────────────
  // table-level QoL flags
  // ──────────────────────────────────────────────────────────────────
  // `disable_direct_insert`: when true, records can only be added via
  // a form. The records-grid + direct API insert paths return 403; the
  // form-submit handler bypasses the check (form-driven inserts are
  // always allowed). Used for "submission inbox" tables where every
  // record must go through validation.
  await sql`ALTER TABLE grids.tables ADD COLUMN IF NOT EXISTS disable_direct_insert BOOLEAN NOT NULL DEFAULT FALSE`.simple();
  console.log("  ✓ grids.tables.disable_direct_insert");

  // ──────────────────────────────────────────────────────────────────
  // primary_field_id drop
  // ──────────────────────────────────────────────────────────────────
  // Dead column — never read by any code path, just persisted +
  // pass-through. Record-label generation lives on the per-field
  // `presentable` flag (multiple presentable fields joined with
  // " · "). Kept the migration idempotent so reruns are safe.
  await sql`ALTER TABLE grids.tables DROP COLUMN IF EXISTS primary_field_id`.simple();
  console.log("  ✓ grids.tables.primary_field_id (dropped)");

  // ──────────────────────────────────────────────────────────────────
  // form field_snapshot drop
  // ──────────────────────────────────────────────────────────────────
  // The frozen-snapshot model proved harder to explain than it was
  // worth: published forms got "stuck" on stale field metadata and
  // form-authors didn't notice they had to refresh. Replaced with a
  // confirm-on-save warning when the form is publicly shared. Live
  // fields drive everything from now on.
  await sql`ALTER TABLE grids.forms DROP COLUMN IF EXISTS field_snapshot`.simple();
  console.log("  ✓ grids.forms.field_snapshot (dropped)");

  // ──────────────────────────────────────────────────────────────────
  // Short ids alongside UUIDs
  // ──────────────────────────────────────────────────────────────────
  // Every base/table/field/form/view/dashboard gets a 5-char readable
  // `short_id` used for URLs (`/app/grids/k3Mp9/table/8sk2X/edit`) and
  // formula references (`#a3X8b`). UUIDs stay as PKs and FKs —
  // short_ids are surface-level only. Records are not short-id'd
  // (high cardinality; UUIDv7 stays).
  //
  // Naming matches the `short_id` convention notebooks uses (single
  // global concept, single name across packages). The 5-char length
  // is grids-specific because uniqueness is per-scope (table within
  // base, field within table, etc) — at 62^5 ≈ 916M slots per scope
  // the birthday collision rate is negligible. Notebooks uses 6 chars
  // because its scope is global.
  //
  // Idempotent rename block — for environments that ran an older
  // migration where the column was called `slug`. Pure rename, no
  // data loss; the existing 5-char base62 values transfer 1:1. The
  // information_schema check makes this a no-op once the rename has
  // landed. The accompanying index/constraint renames live further
  // down (after the create blocks) so a clean fresh install creates
  // them under the new name from the start.
  for (const table of ["bases", "tables", "fields", "forms", "views", "dashboards"] as const) {
    await sql
      .unsafe(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'grids' AND table_name = '${table}'
              AND column_name = 'slug'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'grids' AND table_name = '${table}'
              AND column_name = 'short_id'
          ) THEN
            ALTER TABLE grids.${table} RENAME COLUMN slug TO short_id;
          END IF;
        END $$;
      `)
      .simple();
  }

  await sql`ALTER TABLE grids.bases      ADD COLUMN IF NOT EXISTS short_id TEXT`.simple();
  await sql`ALTER TABLE grids.tables     ADD COLUMN IF NOT EXISTS short_id TEXT`.simple();
  await sql`ALTER TABLE grids.fields     ADD COLUMN IF NOT EXISTS short_id TEXT`.simple();
  await sql`ALTER TABLE grids.forms      ADD COLUMN IF NOT EXISTS short_id TEXT`.simple();
  await sql`ALTER TABLE grids.views      ADD COLUMN IF NOT EXISTS short_id TEXT`.simple();

  // Drop the old slug-named indexes if they still exist (only on DBs
  // that ran the pre-rename migration). The new short_id indexes are
  // created in the block below.
  await sql`DROP INDEX IF EXISTS grids.idx_grids_bases_slug`.simple();
  await sql`DROP INDEX IF EXISTS grids.idx_grids_tables_slug`.simple();
  await sql`DROP INDEX IF EXISTS grids.idx_grids_fields_slug`.simple();
  await sql`DROP INDEX IF EXISTS grids.idx_grids_forms_slug`.simple();
  await sql`DROP INDEX IF EXISTS grids.idx_grids_views_slug`.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_bases_short_id
    ON grids.bases(short_id) WHERE deleted_at IS NULL AND short_id IS NOT NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_tables_short_id
    ON grids.tables(base_id, short_id) WHERE deleted_at IS NULL AND short_id IS NOT NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_fields_short_id
    ON grids.fields(table_id, short_id) WHERE deleted_at IS NULL AND short_id IS NOT NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_forms_short_id
    ON grids.forms(table_id, short_id) WHERE deleted_at IS NULL AND short_id IS NOT NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_views_short_id
    ON grids.views(table_id, short_id) WHERE deleted_at IS NULL AND short_id IS NOT NULL
  `.simple();
  console.log("  ✓ grids.{bases,tables,fields,forms,views}.short_id + unique indexes");

  // ──────────────────────────────────────────────────────────────────
  // dashboards (P0 — stat cards + embedded views; chart widgets ship
  // in P1 once the chart-render lib lands)
  // ──────────────────────────────────────────────────────────────────
  // Per-base composition surface. The `config` JSONB carries the full
  // layout tree (rows × cells × widgets) — same blob-on-row pattern as
  // forms.config and views.query. Keeps reads atomic and lets us evolve
  // the widget shape without DDL. owner_user_id mirrors the views model
  // (NULL = shared, UUID = personal). dashboard_access narrows visibility
  // for shared dashboards the same way view_access does.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.dashboards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      config JSONB NOT NULL DEFAULT '{"rows":[]}'::jsonb,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      position INT NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  // Hot path: list alive dashboards of a base in user-defined order.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_dashboards_base_live
    ON grids.dashboards(base_id, position) WHERE deleted_at IS NULL
  `.simple();
  // short_id uniqueness scoped per base, alive rows only — same
  // partial-index pattern as the other short-id-bearing tables.
  await sql`DROP INDEX IF EXISTS grids.idx_grids_dashboards_slug`.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_dashboards_short_id
    ON grids.dashboards(base_id, short_id) WHERE deleted_at IS NULL AND short_id IS NOT NULL
  `.simple();
  console.log("  ✓ grids.dashboards");

  // dashboard_access: same junction shape as view_access. Level is
  // implicit `read` — the API rejects write/admin grants because they
  // don't make semantic sense for a saved layout (edit-rights flow from
  // base-write or owner, not from a per-dashboard ACL).
  await sql`
    CREATE TABLE IF NOT EXISTS grids.dashboard_access (
      dashboard_id UUID NOT NULL REFERENCES grids.dashboards(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (dashboard_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_dashboard_access_access ON grids.dashboard_access(access_id)`.simple();
  console.log("  ✓ grids.dashboard_access");

  // bases.default_dashboard_id: when set, opening /grids/<base> with no
  // ?table or ?dashboard query param renders this dashboard. Nullable
  // and intentionally NOT a hard FK — we don't want a base-level dep
  // on the dashboards table to constrain ordering or destruction.
  // Service layer treats a stale id (referenced dashboard soft-deleted
  // or hard-deleted) as "no default" and falls back to first table.
  await sql`ALTER TABLE grids.bases ADD COLUMN IF NOT EXISTS default_dashboard_id UUID`.simple();
  console.log("  ✓ grids.bases.default_dashboard_id");

  // ──────────────────────────────────────────────────────────────────
  // short_id backfill for rows that pre-date the column
  // ──────────────────────────────────────────────────────────────────
  // ALTER TABLE ADD COLUMN above is NULL-tolerant so old rows survive
  // the migration. The service layer assigns short_ids on insert, but
  // rows created before that migration ran sit at NULL forever unless
  // we backfill — and the SSR URL builders interpolate the
  // (NULL-coerced-to-empty) short_id straight into hrefs, producing
  // `/table//edit` and similar dead links. Generate one short_id per
  // alive row, scoped per parent so the partial unique index is
  // honored. Runs every boot; no-op once all rows are filled.
  await backfillShortIds();
  console.log("  ✓ grids.{bases,tables,fields,forms,views,dashboards}.short_id backfill");
};

// =============================================================================
// short_id backfill helpers
// =============================================================================

/** Generate a unique short_id within (table, scope), checking ALL rows
 *  (alive + trashed) to keep restore paths safe — a trashed row that
 *  shares an id with an alive row would conflict on restore. 10 attempts
 *  is overkill for 62^5 ≈ 916M slots; even at 1000 items per scope the
 *  birthday-paradox single-try collision rate is ~0.054%. */
const generateShortId = async (
  query: (cand: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const cand = crypto.common.readableId(5);
    if (!(await query(cand))) return cand;
  }
  throw new Error("backfill: failed to generate unique short_id after 10 attempts");
};

const backfillShortIds = async (): Promise<void> => {
  // We backfill ALL rows (alive + trashed). The partial unique index only
  // covers alive rows, but trashed rows still serve URL/audit references
  // and can be restored — they need short_ids too, and those ids must
  // not collide with any other row in the same scope or restore breaks.
  // Hence the EXISTS check has no `deleted_at IS NULL` filter either.

  // bases — global scope
  {
    const rows = await sql<{ id: string }[]>`SELECT id::text AS id FROM grids.bases WHERE short_id IS NULL`;
    for (const row of rows) {
      const shortId = await generateShortId(async (cand) => {
        const [r] = await sql<{ exists: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM grids.bases WHERE short_id = ${cand}) AS exists
        `;
        return Boolean(r?.exists);
      });
      await sql`UPDATE grids.bases SET short_id = ${shortId} WHERE id = ${row.id}::uuid`;
    }
  }
  // tables — scoped per base
  {
    const rows = await sql<{ id: string; base_id: string }[]>`
      SELECT id::text AS id, base_id::text AS base_id FROM grids.tables WHERE short_id IS NULL
    `;
    for (const row of rows) {
      const shortId = await generateShortId(async (cand) => {
        const [r] = await sql<{ exists: boolean }[]>`
          SELECT EXISTS(
            SELECT 1 FROM grids.tables
            WHERE base_id = ${row.base_id}::uuid AND short_id = ${cand}
          ) AS exists
        `;
        return Boolean(r?.exists);
      });
      await sql`UPDATE grids.tables SET short_id = ${shortId} WHERE id = ${row.id}::uuid`;
    }
  }
  // fields — scoped per table
  {
    const rows = await sql<{ id: string; table_id: string }[]>`
      SELECT id::text AS id, table_id::text AS table_id FROM grids.fields WHERE short_id IS NULL
    `;
    for (const row of rows) {
      const shortId = await generateShortId(async (cand) => {
        const [r] = await sql<{ exists: boolean }[]>`
          SELECT EXISTS(
            SELECT 1 FROM grids.fields
            WHERE table_id = ${row.table_id}::uuid AND short_id = ${cand}
          ) AS exists
        `;
        return Boolean(r?.exists);
      });
      await sql`UPDATE grids.fields SET short_id = ${shortId} WHERE id = ${row.id}::uuid`;
    }
  }
  // forms — scoped per table
  {
    const rows = await sql<{ id: string; table_id: string }[]>`
      SELECT id::text AS id, table_id::text AS table_id FROM grids.forms WHERE short_id IS NULL
    `;
    for (const row of rows) {
      const shortId = await generateShortId(async (cand) => {
        const [r] = await sql<{ exists: boolean }[]>`
          SELECT EXISTS(
            SELECT 1 FROM grids.forms
            WHERE table_id = ${row.table_id}::uuid AND short_id = ${cand}
          ) AS exists
        `;
        return Boolean(r?.exists);
      });
      await sql`UPDATE grids.forms SET short_id = ${shortId} WHERE id = ${row.id}::uuid`;
    }
  }
  // views — scoped per table
  {
    const rows = await sql<{ id: string; table_id: string }[]>`
      SELECT id::text AS id, table_id::text AS table_id FROM grids.views WHERE short_id IS NULL
    `;
    for (const row of rows) {
      const shortId = await generateShortId(async (cand) => {
        const [r] = await sql<{ exists: boolean }[]>`
          SELECT EXISTS(
            SELECT 1 FROM grids.views
            WHERE table_id = ${row.table_id}::uuid AND short_id = ${cand}
          ) AS exists
        `;
        return Boolean(r?.exists);
      });
      await sql`UPDATE grids.views SET short_id = ${shortId} WHERE id = ${row.id}::uuid`;
    }
  }
  // dashboards — scoped per base
  {
    const rows = await sql<{ id: string; base_id: string }[]>`
      SELECT id::text AS id, base_id::text AS base_id FROM grids.dashboards WHERE short_id IS NULL
    `;
    for (const row of rows) {
      const shortId = await generateShortId(async (cand) => {
        const [r] = await sql<{ exists: boolean }[]>`
          SELECT EXISTS(
            SELECT 1 FROM grids.dashboards
            WHERE base_id = ${row.base_id}::uuid AND short_id = ${cand}
          ) AS exists
        `;
        return Boolean(r?.exists);
      });
      await sql`UPDATE grids.dashboards SET short_id = ${shortId} WHERE id = ${row.id}::uuid`;
    }
  }

  // After all rows are filled, tighten the schema: NOT NULL + CHECK so
  // the contract-layer ShortIdSchema and DB row state cannot drift.
  //
  // Both branches are idempotent at the SQL layer:
  //   - ALTER COLUMN ... SET NOT NULL is a no-op when the column
  //     already disallows NULL.
  //   - The CHECK constraint is guarded by a SELECT against pg_constraint
  //     in a DO block. We use this rather than a JS-side try/catch
  //     because Bun.sql buries the Postgres SQLSTATE in `errno`, not
  //     `code` (which gets set to `ERR_POSTGRES_SERVER_ERROR`).
  //   - Old environments may have `<table>_slug_format_chk` from the
  //     pre-rename migration; we DROP IF EXISTS that one first so the
  //     CHECK regex isn't enforced under the old name forever.
  for (const table of ["bases", "tables", "fields", "forms", "views", "dashboards"] as const) {
    await sql.unsafe(`ALTER TABLE grids.${table} ALTER COLUMN short_id SET NOT NULL`).simple();
    await sql
      .unsafe(`ALTER TABLE grids.${table} DROP CONSTRAINT IF EXISTS ${table}_slug_format_chk`)
      .simple();
    await sql
      .unsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = '${table}_short_id_format_chk'
              AND conrelid = 'grids.${table}'::regclass
          ) THEN
            ALTER TABLE grids.${table}
            ADD CONSTRAINT ${table}_short_id_format_chk
            CHECK (short_id ~ '^[A-Za-z0-9]{5}$');
          END IF;
        END $$;
      `)
      .simple();
  }
};
