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
  // Safe-cast helpers
  // ──────────────────────────────────────────────────────────────────
  // Query compilers route casts through these helpers so malformed JSONB
  // values sort/filter as NULL instead of crashing the whole table read.
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
  // Immutable ISO date parser for expression indexes. We only accept the
  // canonical app-written date shape (YYYY-MM-DD); anything else returns NULL
  // instead of depending on session DateStyle.
  await sql`
    CREATE OR REPLACE FUNCTION grids.try_iso_date(t text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE STRICT AS $$
    BEGIN
      IF t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RETURN NULL;
      END IF;
      RETURN make_date(substring(t, 1, 4)::int, substring(t, 6, 2)::int, substring(t, 9, 2)::int);
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END $$
  `.simple();
  await sql`
    CREATE OR REPLACE FUNCTION grids.try_timestamptz(t text) RETURNS timestamptz
    LANGUAGE plpgsql STABLE STRICT AS $$
    BEGIN RETURN t::timestamptz; EXCEPTION WHEN others THEN RETURN NULL; END $$
  `.simple();
  await sql`
    CREATE OR REPLACE FUNCTION grids.try_timestamp(t text) RETURNS timestamp
    LANGUAGE plpgsql IMMUTABLE STRICT AS $$
    BEGIN RETURN t::timestamp; EXCEPTION WHEN others THEN RETURN NULL; END $$
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
      short_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      default_dashboard_id UUID,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT bases_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$')
    )
  `.simple();
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
      short_id TEXT NOT NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      display_config JSONB NOT NULL DEFAULT '{"mode":"table"}'::jsonb,
      position INT NOT NULL DEFAULT 0,
      disable_direct_insert BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT tables_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$')
    )
  `.simple();
  // Hot-path index: list live tables of a base in order.
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_tables_base_live ON grids.tables(base_id, position) WHERE deleted_at IS NULL`.simple();
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
      short_id TEXT NOT NULL,
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      type TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INT NOT NULL DEFAULT 0,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      default_value JSONB,
      indexed BOOLEAN NOT NULL DEFAULT FALSE,
      unique_constraint BOOLEAN NOT NULL DEFAULT FALSE,
      presentable BOOLEAN NOT NULL DEFAULT FALSE,
      hide_in_table BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT fields_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$')
    )
  `.simple();
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
  // Relation values live in a junction table instead of records.data so
  // Postgres enforces link integrity and reverse lookups stay indexed.
  // `position` preserves user order for multi-relation fields.
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
  // Reverse read: "all records linking to X via field F".
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_record_links_reverse ON grids.record_links(to_record_id, from_field_id)`.simple();
  console.log("  ✓ grids.record_links");

  // ──────────────────────────────────────────────────────────────────
  // views
  // ──────────────────────────────────────────────────────────────────
  // owner_user_id NULL = shared (visible to anyone with table-read).
  // `source` carries the canonical GQL query. `ui` carries view-owned
  // presentation settings; data semantics are never persisted as RecordQuery.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      source TEXT NOT NULL,
      ui JSONB NOT NULL DEFAULT '{}'::jsonb,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      position INT NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT views_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$'),
      CONSTRAINT views_source_length_chk CHECK (length(source) BETWEEN 1 AND 20000)
    )
  `.simple();
  await sql`ALTER TABLE grids.views ADD COLUMN IF NOT EXISTS description TEXT`.simple();
  await sql`ALTER TABLE grids.views ADD COLUMN IF NOT EXISTS ui JSONB NOT NULL DEFAULT '{}'::jsonb`.simple();
  await sql`ALTER TABLE grids.views DROP COLUMN IF EXISTS query`.simple();
  await sql`ALTER TABLE grids.views DROP COLUMN IF EXISTS display_config`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_views_table_live ON grids.views(table_id, position) WHERE deleted_at IS NULL`.simple();
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

  await sql`DROP TABLE IF EXISTS grids.gql_queries CASCADE`.simple();

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
      short_id TEXT NOT NULL,
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      public_token TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      position INT NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT forms_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$')
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_forms_table_live ON grids.forms(table_id, position) WHERE deleted_at IS NULL`.simple();
  // Public-token lookup is the public form's hot path; partial index keeps
  // it scoped to forms that are actually public AND alive.
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

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_bases_short_id
    ON grids.bases(short_id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_tables_short_id
    ON grids.tables(base_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_fields_short_id
    ON grids.fields(table_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_forms_short_id
    ON grids.forms(table_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_views_short_id
    ON grids.views(table_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  console.log("  ✓ grids.{bases,tables,fields,forms,views}.short_id + unique indexes");

  // ──────────────────────────────────────────────────────────────────
  // dashboards
  // ──────────────────────────────────────────────────────────────────
  // Per-base composition surface. The `config` JSONB carries the full
  // layout tree (rows × cells × widgets) — same blob-on-row pattern as
  // forms.config and views.ui. Keeps reads atomic and lets us evolve
  // the widget shape without DDL. owner_user_id mirrors the views model
  // (NULL = shared, UUID = personal). dashboard_access narrows visibility
  // for shared dashboards the same way view_access does.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.dashboards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      config JSONB NOT NULL DEFAULT '{"rows":[]}'::jsonb,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      position INT NOT NULL DEFAULT 0,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT dashboards_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$')
    )
  `.simple();
  // Hot path: list alive dashboards of a base in user-defined order.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_dashboards_base_live
    ON grids.dashboards(base_id, position) WHERE deleted_at IS NULL
  `.simple();
  // short_id uniqueness scoped per base, alive rows only — same
  // partial-index pattern as the other short-id-bearing tables.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_dashboards_short_id
    ON grids.dashboards(base_id, short_id) WHERE deleted_at IS NULL
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

  // ──────────────────────────────────────────────────────────────────
  // automations — base-level triggers/actions
  // ──────────────────────────────────────────────────────────────────
  // Trigger/action stay JSONB discriminants so automation capabilities can
  // evolve without DDL churn.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.automations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      trigger JSONB NOT NULL DEFAULT '{"kind":"manual"}'::jsonb,
      action JSONB NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      webhook_secret TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      position INT NOT NULL DEFAULT 0,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT automations_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$')
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_automations_base_live
    ON grids.automations(base_id, position) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_automations_schedule_live
    ON grids.automations(base_id, enabled) WHERE deleted_at IS NULL AND trigger->>'kind' = 'schedule'
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_automations_short_id
    ON grids.automations(base_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  console.log("  ✓ grids.automations");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.automation_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id UUID NOT NULL REFERENCES grids.automations(id) ON DELETE CASCADE,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      -- Intentionally not FK'd: run history should survive subject table/record hard-deletes.
      table_id UUID,
      record_id UUID,
      event TEXT NOT NULL,
      trigger JSONB NOT NULL,
      subject JSONB NOT NULL,
      input JSONB,
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
      target_host TEXT,
      http_status INT,
      duration_ms INT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_automation_runs_automation
    ON grids.automation_runs(automation_id, created_at DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_automation_runs_base
    ON grids.automation_runs(base_id, created_at DESC)
  `.simple();
  console.log("  ✓ grids.automation_runs");

  console.log("  ✓ grids schema ready");
};
