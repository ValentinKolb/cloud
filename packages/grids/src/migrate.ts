import { sql } from "bun";

/**
 * Schema for the Grids app: bases → tables → fields, records, views, forms,
 * document templates, dashboards, workflows, and generated artifacts.
 *
 * Storage strategy: records use JSONB keyed by stable field IDs. Per-field
 * expression indexes are opt-in (`fields.indexed=true`). No GIN on `data` by
 * default — ad-hoc filter performance is the user's call when they enable
 * indexing per field.
 *
 * Permission model: one `auth.access` row bound through a Grids resource-specific
 * junction table. Base grants are the broad scope; table/view/form/document
 * template/dashboard/workflow grants can narrow or expose specific surfaces.
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
      document_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      default_dashboard_id UUID,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT bases_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$')
    )
  `.simple();
  await sql`ALTER TABLE grids.bases ADD COLUMN IF NOT EXISTS document_profile JSONB NOT NULL DEFAULT '{}'::jsonb`.simple();
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
  // Alpha cleanup: number precision used to persist as `scale`. Normalize once
  // so runtime and UI only have one decimal-place config key.
  await sql`
    UPDATE grids.fields
    SET config = (config - 'scale') || jsonb_build_object('decimalPlaces', (config->>'scale')::int)
    WHERE type = 'number'
      AND config ? 'scale'
      AND NOT (config ? 'decimalPlaces')
      AND jsonb_typeof(config->'scale') = 'number'
      AND config->>'scale' ~ '^[0-9]+$'
      AND (config->>'scale')::int BETWEEN 0 AND 20
  `.simple();
  await sql`
    UPDATE grids.fields
    SET config = config - 'scale'
    WHERE type = 'number'
      AND config ? 'scale'
  `.simple();
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
  // document templates / snapshots / runs
  // ──────────────────────────────────────────────────────────────────
  // Templates are table-level render definitions. They store a Liquid-rendered
  // GQL source plus a Liquid-rendered HTML template. Official document runs
  // snapshot the template and render data; PDFs are regenerated on download.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.document_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL,
      html TEXT NOT NULL,
      header_html TEXT,
      footer_html TEXT,
      page_css TEXT,
      number_template TEXT NOT NULL DEFAULT '{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}',
      filename_template TEXT NOT NULL DEFAULT '{{ document.number }}.pdf',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      position INT NOT NULL DEFAULT 0,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT document_templates_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$'),
      CONSTRAINT document_templates_source_length_chk CHECK (length(source) BETWEEN 1 AND 20000),
      CONSTRAINT document_templates_html_length_chk CHECK (length(html) BETWEEN 1 AND 200000),
      CONSTRAINT document_templates_header_html_length_chk CHECK (header_html IS NULL OR length(header_html) <= 50000),
      CONSTRAINT document_templates_footer_html_length_chk CHECK (footer_html IS NULL OR length(footer_html) <= 50000),
      CONSTRAINT document_templates_page_css_length_chk CHECK (page_css IS NULL OR length(page_css) <= 50000),
      CONSTRAINT document_templates_number_template_length_chk CHECK (length(number_template) BETWEEN 1 AND 5000),
      CONSTRAINT document_templates_filename_template_length_chk CHECK (length(filename_template) BETWEEN 1 AND 5000)
    )
  `.simple();
  await sql`ALTER TABLE grids.document_templates ADD COLUMN IF NOT EXISTS header_html TEXT`.simple();
  await sql`ALTER TABLE grids.document_templates ADD COLUMN IF NOT EXISTS footer_html TEXT`.simple();
  await sql`ALTER TABLE grids.document_templates ADD COLUMN IF NOT EXISTS page_css TEXT`.simple();
  await sql`ALTER TABLE grids.document_templates ADD COLUMN IF NOT EXISTS number_template TEXT`.simple();
  await sql`ALTER TABLE grids.document_templates ADD COLUMN IF NOT EXISTS filename_template TEXT`.simple();
  await sql`
    UPDATE grids.document_templates
    SET number_template = '{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}'
    WHERE number_template IS NULL OR btrim(number_template) = ''
  `.simple();
  await sql`
    UPDATE grids.document_templates
    SET filename_template = '{{ document.number }}.pdf'
    WHERE filename_template IS NULL OR btrim(filename_template) = ''
  `.simple();
  await sql`ALTER TABLE grids.document_templates ALTER COLUMN number_template SET DEFAULT '{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}'`.simple();
  await sql`ALTER TABLE grids.document_templates ALTER COLUMN number_template SET NOT NULL`.simple();
  await sql`ALTER TABLE grids.document_templates ALTER COLUMN filename_template SET DEFAULT '{{ document.number }}.pdf'`.simple();
  await sql`ALTER TABLE grids.document_templates ALTER COLUMN filename_template SET NOT NULL`.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_templates_header_html_length_chk' AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_templates
        ADD CONSTRAINT document_templates_header_html_length_chk CHECK (header_html IS NULL OR length(header_html) <= 50000);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_templates_footer_html_length_chk' AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_templates
        ADD CONSTRAINT document_templates_footer_html_length_chk CHECK (footer_html IS NULL OR length(footer_html) <= 50000);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_templates_page_css_length_chk' AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_templates
        ADD CONSTRAINT document_templates_page_css_length_chk CHECK (page_css IS NULL OR length(page_css) <= 50000);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_templates_number_template_length_chk' AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_templates
        ADD CONSTRAINT document_templates_number_template_length_chk CHECK (length(number_template) BETWEEN 1 AND 5000);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_templates_filename_template_length_chk' AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_templates
        ADD CONSTRAINT document_templates_filename_template_length_chk CHECK (length(filename_template) BETWEEN 1 AND 5000);
      END IF;
    END $$;
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_document_templates_table_live
    ON grids.document_templates(table_id, position) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_document_templates_short_id
    ON grids.document_templates(table_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  console.log("  ✓ grids.document_templates");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.document_template_access (
      template_id UUID NOT NULL REFERENCES grids.document_templates(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (template_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_document_template_access_access ON grids.document_template_access(access_id)`.simple();
  console.log("  ✓ grids.document_template_access");

  // ──────────────────────────────────────────────────────────────────
  // email templates
  // ──────────────────────────────────────────────────────────────────
  // Email templates are base-level Liquid templates used by workflows. They
  // intentionally stay separate from document templates: no GQL source, no PDF
  // page parts, no record snapshot ownership.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.email_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      subject TEXT NOT NULL,
      html TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      position INT NOT NULL DEFAULT 0,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT email_templates_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$'),
      CONSTRAINT email_templates_subject_length_chk CHECK (length(subject) BETWEEN 1 AND 1000),
      CONSTRAINT email_templates_html_length_chk CHECK (length(html) BETWEEN 1 AND 200000)
    )
  `.simple();
  await sql`ALTER TABLE grids.email_templates DROP CONSTRAINT IF EXISTS email_templates_text_length_chk`.simple();
  await sql`ALTER TABLE grids.email_templates DROP COLUMN IF EXISTS text`.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_email_templates_base_live
    ON grids.email_templates(base_id, position) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_email_templates_short_id
    ON grids.email_templates(base_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  console.log("  ✓ grids.email_templates");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.record_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL,
      table_id UUID NOT NULL,
      record_id UUID NOT NULL,
      root JSONB NOT NULL,
      graph JSONB NOT NULL,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_record_snapshots_record
    ON grids.record_snapshots(table_id, record_id, created_at DESC)
  `.simple();
  console.log("  ✓ grids.record_snapshots");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.document_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      template_id UUID,
      workflow_run_id UUID,
      snapshot_id UUID NOT NULL REFERENCES grids.record_snapshots(id) ON DELETE RESTRICT,
      base_id UUID NOT NULL,
      table_id UUID NOT NULL,
      record_id UUID NOT NULL,
      document_number TEXT NOT NULL,
      filename TEXT NOT NULL,
      tags TEXT[] NOT NULL DEFAULT '{}',
      template_snapshot JSONB NOT NULL,
      render_data JSONB NOT NULL,
      generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT document_runs_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$'),
      CONSTRAINT document_runs_filename_length_chk CHECK (length(filename) BETWEEN 1 AND 255),
      CONSTRAINT document_runs_tags_count_chk CHECK (cardinality(tags) <= 20)
    )
  `.simple();
  await sql`ALTER TABLE grids.document_runs ADD COLUMN IF NOT EXISTS workflow_run_id UUID`.simple();
  await sql`ALTER TABLE grids.document_runs ADD COLUMN IF NOT EXISTS filename TEXT`.simple();
  await sql`
    UPDATE grids.document_runs
    SET filename = document_number || '.pdf'
    WHERE filename IS NULL OR btrim(filename) = ''
  `.simple();
  await sql`ALTER TABLE grids.document_runs ALTER COLUMN filename SET DEFAULT 'document.pdf'`.simple();
  await sql`ALTER TABLE grids.document_runs ALTER COLUMN filename SET NOT NULL`.simple();
  await sql`ALTER TABLE grids.document_runs ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`.simple();
  await sql`UPDATE grids.document_runs SET tags = '{}' WHERE tags IS NULL`.simple();
  await sql`ALTER TABLE grids.document_runs ALTER COLUMN tags SET NOT NULL`.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_runs_filename_length_chk' AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_runs
        ADD CONSTRAINT document_runs_filename_length_chk CHECK (length(filename) BETWEEN 1 AND 255);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_runs_tags_count_chk' AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_runs
        ADD CONSTRAINT document_runs_tags_count_chk CHECK (cardinality(tags) <= 20);
      END IF;
    END $$;
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_document_runs_number
    ON grids.document_runs(document_number)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_document_runs_template
    ON grids.document_runs(template_id, generated_at DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_document_runs_template_cursor
    ON grids.document_runs(template_id, generated_at DESC, id DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_document_runs_record
    ON grids.document_runs(table_id, record_id, generated_at DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_document_runs_workflow_run
    ON grids.document_runs(workflow_run_id, generated_at DESC, id DESC)
    WHERE workflow_run_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_document_runs_tags
    ON grids.document_runs USING GIN(tags)
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_document_runs_short_id
    ON grids.document_runs(table_id, short_id)
  `.simple();
  console.log("  ✓ grids.document_runs");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.document_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_run_id UUID NOT NULL REFERENCES grids.document_runs(id) ON DELETE CASCADE,
      base_id UUID NOT NULL,
      table_id UUID NOT NULL,
      record_id UUID NOT NULL,
      token_hash TEXT NOT NULL,
      comment TEXT,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      last_accessed_at TIMESTAMPTZ,
      access_count INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT document_links_comment_length_chk CHECK (comment IS NULL OR length(comment) <= 500),
      CONSTRAINT document_links_access_count_chk CHECK (access_count >= 0)
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_document_links_token_hash
    ON grids.document_links(token_hash)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_document_links_run
    ON grids.document_links(document_run_id, created_at DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_document_links_active
    ON grids.document_links(expires_at)
    WHERE revoked_at IS NULL
  `.simple();
  console.log("  ✓ grids.document_links");

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
  // form schema), admin == form CRUD which lives at base-admin.
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
    CREATE TABLE IF NOT EXISTS grids.record_event_outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      record_id UUID NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error TEXT,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT record_event_outbox_status_check CHECK (status IN ('pending', 'failed', 'delivered', 'dead'))
    )
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'record_event_outbox_status_check'
          AND connamespace = 'grids'::regnamespace
          AND pg_get_constraintdef(oid) NOT LIKE '%dead%'
      ) THEN
        ALTER TABLE grids.record_event_outbox DROP CONSTRAINT record_event_outbox_status_check;
        ALTER TABLE grids.record_event_outbox
          ADD CONSTRAINT record_event_outbox_status_check CHECK (status IN ('pending', 'failed', 'delivered', 'dead'));
      END IF;
    END $$
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_record_event_outbox_pending
    ON grids.record_event_outbox(next_attempt_at, created_at)
    WHERE status IN ('pending', 'failed')
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_record_event_outbox_delivered
    ON grids.record_event_outbox(delivered_at)
    WHERE status = 'delivered'
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF to_regprocedure('grids.enqueue_record_event(uuid,uuid,jsonb)') IS NULL THEN
        BEGIN
          EXECUTE $function$
            CREATE FUNCTION grids.enqueue_record_event(p_table_id uuid, p_record_id uuid, p_payload jsonb)
            RETURNS uuid
            LANGUAGE plpgsql
            VOLATILE
            AS $body$
            DECLARE
              outbox_id uuid := gen_random_uuid();
              event_base_id uuid;
            BEGIN
              SELECT base_id INTO event_base_id FROM grids.tables WHERE id = p_table_id;
              IF event_base_id IS NULL THEN
                RAISE EXCEPTION 'record event table does not exist';
              END IF;
              INSERT INTO grids.record_event_outbox (id, base_id, table_id, record_id, payload)
              VALUES (
                outbox_id,
                event_base_id,
                p_table_id,
                p_record_id,
                p_payload || jsonb_build_object('baseId', event_base_id::text, 'tableId', p_table_id::text, 'recordId', p_record_id::text)
              );
              RETURN outbox_id;
            END;
            $body$
          $function$;
        EXCEPTION WHEN duplicate_function THEN
          NULL;
        END;
      END IF;
    END $$
  `.simple();
  console.log("  ✓ grids.record_event_outbox");

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
  // workflows — YAML-authored base-level runtime definitions
  // ──────────────────────────────────────────────────────────────────
  // `source` is the user-authored YAML. `compiled` is the validated typed AST
  // produced by the backend parser; runtime workers execute only `compiled`.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL,
      compiled JSONB NOT NULL DEFAULT '{}'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      position INT NOT NULL DEFAULT 0,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT workflows_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$'),
      CONSTRAINT workflows_source_length_chk CHECK (length(source) BETWEEN 1 AND 200000)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflows_base_live
    ON grids.workflows(base_id, position) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflows_enabled_live
    ON grids.workflows(base_id, enabled) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_workflows_short_id
    ON grids.workflows(base_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  console.log("  ✓ grids.workflows");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_access (
      workflow_id UUID NOT NULL REFERENCES grids.workflows(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (workflow_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_workflow_access_access ON grids.workflow_access(access_id)`.simple();
  console.log("  ✓ grids.workflow_access");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID REFERENCES grids.workflows(id) ON DELETE SET NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      service_account_id UUID REFERENCES auth.service_accounts(id) ON DELETE SET NULL,
      actor_group_ids UUID[] NOT NULL DEFAULT '{}',
      trigger_authorization JSONB NOT NULL DEFAULT '{"kind":"workflow"}'::jsonb,
      trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('form', 'api', 'scanner', 'bulkSelection', 'dashboardButton', 'schedule', 'recordEvent')),
      trigger_input JSONB,
      resolved_input JSONB,
      trigger_key TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
      error TEXT,
      result_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      lease_expires_at TIMESTAMPTZ,
      queue_attempts INT NOT NULL DEFAULT 0 CHECK (queue_attempts >= 0),
      last_queue_attempt_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )
  `.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS trigger_key TEXT`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS result_message TEXT`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS actor_group_ids UUID[]`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS trigger_authorization JSONB`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS queue_attempts INT`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS last_queue_attempt_at TIMESTAMPTZ`.simple();
  await sql`
    UPDATE grids.workflow_runs
    SET status = 'failed',
        error = 'Could not recover workflow run created before durable queue payloads were available',
        finished_at = now()
    WHERE status = 'queued'
      AND (actor_group_ids IS NULL OR trigger_authorization IS NULL OR queue_attempts IS NULL)
  `.simple();
  await sql`
    UPDATE grids.workflow_runs
    SET actor_group_ids = COALESCE(actor_group_ids, '{}'::uuid[]),
        trigger_authorization = COALESCE(trigger_authorization, '{"kind":"workflow"}'::jsonb),
        queue_attempts = COALESCE(queue_attempts, 0)
    WHERE actor_group_ids IS NULL OR trigger_authorization IS NULL OR queue_attempts IS NULL
  `.simple();
  await sql`ALTER TABLE grids.workflow_runs ALTER COLUMN actor_group_ids SET DEFAULT '{}'::uuid[]`.simple();
  await sql`ALTER TABLE grids.workflow_runs ALTER COLUMN actor_group_ids SET NOT NULL`.simple();
  await sql`ALTER TABLE grids.workflow_runs ALTER COLUMN trigger_authorization SET DEFAULT '{"kind":"workflow"}'::jsonb`.simple();
  await sql`ALTER TABLE grids.workflow_runs ALTER COLUMN trigger_authorization SET NOT NULL`.simple();
  await sql`ALTER TABLE grids.workflow_runs ALTER COLUMN queue_attempts SET DEFAULT 0`.simple();
  await sql`ALTER TABLE grids.workflow_runs ALTER COLUMN queue_attempts SET NOT NULL`.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workflow_runs_queue_attempts_check'
          AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.workflow_runs
          ADD CONSTRAINT workflow_runs_queue_attempts_check CHECK (queue_attempts >= 0);
      END IF;
    END $$
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_runs_workflow
    ON grids.workflow_runs(workflow_id, created_at DESC) WHERE workflow_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_runs_base
    ON grids.workflow_runs(base_id, created_at DESC)
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_workflow_runs_trigger_key
    ON grids.workflow_runs(workflow_id, trigger_kind, trigger_key)
    WHERE trigger_key IS NOT NULL AND workflow_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_runs_queued_recovery
    ON grids.workflow_runs(last_queue_attempt_at, created_at)
    WHERE status = 'queued'
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_runs_workflow_run_id_fkey' AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_runs
        ADD CONSTRAINT document_runs_workflow_run_id_fkey
        FOREIGN KEY (workflow_run_id) REFERENCES grids.workflow_runs(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `.simple();
  console.log("  ✓ grids.workflow_runs");

  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_step_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES grids.workflow_runs(id) ON DELETE CASCADE,
      step_index INT NOT NULL CHECK (step_index >= 0),
      step_path TEXT NOT NULL,
      resume_key TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
      input JSONB,
      output JSONB,
      error TEXT,
      duration_ms INT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )
  `.simple();
  await sql`ALTER TABLE grids.workflow_step_runs ADD COLUMN IF NOT EXISTS resume_key TEXT`.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_step_runs_run
    ON grids.workflow_step_runs(run_id, step_index)
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_workflow_step_runs_resume
    ON grids.workflow_step_runs(run_id, resume_key)
    WHERE resume_key IS NOT NULL
  `.simple();
  console.log("  ✓ grids.workflow_step_runs");

  // Opaque scan codes are lazy-generated record lookup keys. A code does not
  // grant access; scanner workflows still resolve and run through permissions.
  await sql`
    CREATE TABLE IF NOT EXISTS grids.record_scan_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      table_id UUID NOT NULL REFERENCES grids.tables(id) ON DELETE CASCADE,
      record_id UUID NOT NULL REFERENCES grids.records(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      rotated_at TIMESTAMPTZ,
      CONSTRAINT record_scan_codes_code_length_chk CHECK (length(code) BETWEEN 16 AND 200)
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_record_scan_codes_code
    ON grids.record_scan_codes(code)
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_record_scan_codes_active_record
    ON grids.record_scan_codes(record_id) WHERE active = TRUE
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_record_scan_codes_table
    ON grids.record_scan_codes(table_id, record_id) WHERE active = TRUE
  `.simple();
  console.log("  ✓ grids.record_scan_codes");

  console.log("  ✓ grids schema ready");
};
