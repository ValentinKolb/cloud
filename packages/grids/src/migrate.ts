import { sql } from "bun";

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
};
