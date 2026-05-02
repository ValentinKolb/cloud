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
  // bases
  // ──────────────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS grids.bases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      primary_field_id UUID,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_tables_base ON grids.tables(base_id, position)`.simple();
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
  // views
  // ──────────────────────────────────────────────────────────────────
  // owner_user_id NULL = shared (visible to anyone with table-read).
  await sql`
    CREATE TABLE IF NOT EXISTS grids.views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_views_table ON grids.views(table_id, position)`.simple();
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
      public_token TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_forms_table ON grids.forms(table_id, position)`.simple();
  // Public-token lookup is the public form's hot path; partial index keeps
  // it scoped to forms that are actually public.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_forms_public_token ON grids.forms(public_token) WHERE public_token IS NOT NULL`.simple();
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
};
