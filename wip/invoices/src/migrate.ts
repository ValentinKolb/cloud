import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  const ignoreDuplicateConstraint = (error: unknown): void => {
    const dbError = error as { code?: string; errno?: string };
    if (!["42710", "42P07"].includes(dbError.code ?? "") && !["42710", "42P07"].includes(dbError.errno ?? "")) throw error;
  };

  await sql`CREATE SCHEMA IF NOT EXISTS invoices`.simple();
  console.log("  ✓ invoices schema");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_workspaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      default_currency CHAR(3) NOT NULL DEFAULT 'EUR',
      locale TEXT NOT NULL DEFAULT 'de-DE',
      created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      UNIQUE (slug)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_workspaces_archived
    ON invoices.invoice_workspaces(archived_at)
  `.simple();
  console.log("  ✓ invoices.invoice_workspaces table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_workspace_access (
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, access_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_workspace_access_access
    ON invoices.invoice_workspace_access(access_id)
  `.simple();
  console.log("  ✓ invoices.invoice_workspace_access table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_issuer_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address JSONB NOT NULL DEFAULT '{}'::jsonb,
      country CHAR(2) NOT NULL DEFAULT 'DE',
      tax_number TEXT,
      vat_id TEXT,
      email TEXT,
      phone TEXT,
      bank_name TEXT,
      iban TEXT,
      bic TEXT,
      default_payment_terms_days INT NOT NULL DEFAULT 14 CHECK (default_payment_terms_days >= 0),
      default_currency CHAR(3) NOT NULL DEFAULT 'EUR',
      locale TEXT NOT NULL DEFAULT 'de-DE',
      tax_regime TEXT NOT NULL DEFAULT 'standard',
      e_invoice_profile TEXT NOT NULL DEFAULT 'xrechnung',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_issuer_profiles_workspace
    ON invoices.invoice_issuer_profiles(workspace_id, archived_at)
  `.simple();
  console.log("  ✓ invoices.invoice_issuer_profiles table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_sequences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      issuer_profile_id UUID NOT NULL REFERENCES invoices.invoice_issuer_profiles(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL DEFAULT 'invoice',
      name TEXT NOT NULL,
      prefix TEXT NOT NULL DEFAULT '',
      period TEXT,
      next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0),
      padding INT NOT NULL DEFAULT 4 CHECK (padding >= 0 AND padding <= 20),
      last_allocated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      UNIQUE (workspace_id, issuer_profile_id, document_type, name)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_sequences_workspace
    ON invoices.invoice_sequences(workspace_id, archived_at)
  `.simple();
  console.log("  ✓ invoices.invoice_sequences table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      issuer_profile_id UUID NOT NULL REFERENCES invoices.invoice_issuer_profiles(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
      active_version_id UUID,
      created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      UNIQUE (workspace_id, name)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_templates_workspace
    ON invoices.invoice_templates(workspace_id, status, archived_at)
  `.simple();
  console.log("  ✓ invoices.invoice_templates table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_template_access (
      template_id UUID NOT NULL REFERENCES invoices.invoice_templates(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (template_id, access_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_template_access_access
    ON invoices.invoice_template_access(access_id)
  `.simple();
  console.log("  ✓ invoices.invoice_template_access table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_template_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES invoices.invoice_templates(id) ON DELETE CASCADE,
      version INT NOT NULL CHECK (version > 0),
      name_snapshot TEXT NOT NULL,
      issuer_profile_id UUID NOT NULL REFERENCES invoices.invoice_issuer_profiles(id) ON DELETE RESTRICT,
      number_sequence_id UUID NOT NULL REFERENCES invoices.invoice_sequences(id) ON DELETE RESTRICT,
      payment_terms_days INT NOT NULL DEFAULT 14 CHECK (payment_terms_days >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      tax_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
      layout_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      e_invoice_defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      activated_at TIMESTAMPTZ,
      UNIQUE (template_id, version)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_template_versions_template
    ON invoices.invoice_template_versions(template_id, version DESC)
  `.simple();
  console.log("  ✓ invoices.invoice_template_versions table");

  await sql`
    ALTER TABLE invoices.invoice_templates
    ADD CONSTRAINT invoice_templates_active_version_fk
    FOREIGN KEY (active_version_id)
    REFERENCES invoices.invoice_template_versions(id)
    DEFERRABLE INITIALLY DEFERRED
  `.simple().catch((error: unknown) => {
    const dbError = error as { code?: string; errno?: string };
    if (dbError.code !== "42710" && dbError.errno !== "42710") throw error;
  });
  console.log("  ✓ invoices.invoice_templates active version constraint");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL DEFAULT 'invoice'
        CHECK (document_type IN ('invoice', 'correction', 'cancellation')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'issued')),
      template_id UUID NOT NULL REFERENCES invoices.invoice_templates(id) ON DELETE RESTRICT,
      template_version_id UUID REFERENCES invoices.invoice_template_versions(id) ON DELETE RESTRICT,
      issuer_profile_id UUID NOT NULL REFERENCES invoices.invoice_issuer_profiles(id) ON DELETE RESTRICT,
      sequence_id UUID REFERENCES invoices.invoice_sequences(id) ON DELETE RESTRICT,
      invoice_number TEXT,
      contact_id UUID,
      source TEXT NOT NULL DEFAULT 'manual',
      issue_date DATE,
      due_date DATE,
      service_period_start DATE,
      service_period_end DATE,
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      subtotal_net_cents BIGINT NOT NULL DEFAULT 0,
      tax_total_cents BIGINT NOT NULL DEFAULT 0,
      total_gross_cents BIGINT NOT NULL DEFAULT 0,
      rounding_delta_cents BIGINT NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'untracked'
        CHECK (payment_status IN ('untracked', 'open', 'paid', 'overdue', 'written_off')),
      compliance_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      version INT NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      issued_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      issued_at TIMESTAMPTZ,
      CHECK ((status = 'draft' AND invoice_number IS NULL AND issued_at IS NULL) OR (status = 'issued' AND invoice_number IS NOT NULL AND issued_at IS NOT NULL))
    )
  `.simple();
  await sql`ALTER TABLE invoices.invoices ADD COLUMN IF NOT EXISTS compliance_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_issued_number
    ON invoices.invoices(workspace_id, document_type, invoice_number)
    WHERE invoice_number IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_workspace_status
    ON invoices.invoices(workspace_id, status, created_at DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_template
    ON invoices.invoices(template_id, created_at DESC)
  `.simple();
  console.log("  ✓ invoices.invoices table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices.invoices(id) ON DELETE CASCADE,
      position INT NOT NULL CHECK (position > 0),
      kind TEXT NOT NULL DEFAULT 'item',
      external_line_id TEXT,
      article_id TEXT,
      article_sku TEXT,
      title TEXT NOT NULL,
      description TEXT,
      quantity NUMERIC(14, 4) NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL DEFAULT 'piece',
      unit_price_net_cents BIGINT NOT NULL DEFAULT 0 CHECK (unit_price_net_cents >= 0),
      discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
      tax_code TEXT NOT NULL,
      tax_category TEXT NOT NULL,
      tax_rate_bps INT NOT NULL CHECK (tax_rate_bps >= 0),
      tax_country CHAR(2) NOT NULL DEFAULT 'DE',
      legal_reason_code TEXT,
      legal_reason_text TEXT,
      total_net_cents BIGINT NOT NULL DEFAULT 0,
      total_tax_cents BIGINT NOT NULL DEFAULT 0,
      total_gross_cents BIGINT NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (invoice_id, position)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
    ON invoices.invoice_lines(invoice_id, position)
  `.simple();
  console.log("  ✓ invoices.invoice_lines table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_party_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices.invoices(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('seller', 'buyer', 'bill_to', 'ship_to')),
      contact_id UUID,
      name TEXT NOT NULL,
      address JSONB NOT NULL DEFAULT '{}'::jsonb,
      country CHAR(2) NOT NULL DEFAULT 'DE',
      vat_id TEXT,
      tax_number TEXT,
      email TEXT,
      phone TEXT,
      recipient_kind TEXT CHECK (recipient_kind IS NULL OR recipient_kind IN ('business', 'consumer', 'public_sector')),
      supply_type TEXT CHECK (supply_type IS NULL OR supply_type IN ('goods', 'service', 'mixed')),
      buyer_reference TEXT,
      leitweg_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (invoice_id, role)
    )
  `.simple();
  await sql`ALTER TABLE invoices.invoice_party_snapshots ADD COLUMN IF NOT EXISTS recipient_kind TEXT`.simple();
  await sql`ALTER TABLE invoices.invoice_party_snapshots ADD COLUMN IF NOT EXISTS supply_type TEXT`.simple();
  await sql`ALTER TABLE invoices.invoice_party_snapshots ADD COLUMN IF NOT EXISTS buyer_reference TEXT`.simple();
  await sql`ALTER TABLE invoices.invoice_party_snapshots ADD COLUMN IF NOT EXISTS leitweg_id TEXT`.simple();
  await sql`
    ALTER TABLE invoices.invoice_party_snapshots
    ADD CONSTRAINT invoice_party_snapshots_recipient_kind_check
    CHECK (recipient_kind IS NULL OR recipient_kind IN ('business', 'consumer', 'public_sector'))
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_party_snapshots
    ADD CONSTRAINT invoice_party_snapshots_supply_type_check
    CHECK (supply_type IS NULL OR supply_type IN ('goods', 'service', 'mixed'))
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_party_snapshots_invoice
    ON invoices.invoice_party_snapshots(invoice_id)
  `.simple();
  console.log("  ✓ invoices.invoice_party_snapshots table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_tax_breakdowns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices.invoices(id) ON DELETE CASCADE,
      tax_code TEXT NOT NULL,
      tax_category TEXT NOT NULL,
      tax_rate_bps INT NOT NULL CHECK (tax_rate_bps >= 0),
      tax_country CHAR(2) NOT NULL DEFAULT 'DE',
      e_invoice_category_code TEXT NOT NULL,
      legal_reason_code TEXT,
      legal_reason_text TEXT,
      taxable_amount_cents BIGINT NOT NULL DEFAULT 0,
      tax_amount_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_tax_breakdowns_invoice
    ON invoices.invoice_tax_breakdowns(invoice_id)
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_tax_breakdowns_unique_group
    ON invoices.invoice_tax_breakdowns(
      invoice_id,
      tax_code,
      tax_category,
      tax_rate_bps,
      tax_country,
      COALESCE(legal_reason_code, ''),
      COALESCE(legal_reason_text, '')
    )
  `.simple();
  console.log("  ✓ invoices.invoice_tax_breakdowns table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_relations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      from_invoice_id UUID NOT NULL REFERENCES invoices.invoices(id) ON DELETE CASCADE,
      to_invoice_id UUID NOT NULL REFERENCES invoices.invoices(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('corrects', 'cancels', 'replaces', 'created_from_offer', 'created_from_order', 'created_from_delivery_note')),
      reason TEXT,
      created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (from_invoice_id, to_invoice_id, relation_type),
      CHECK (from_invoice_id <> to_invoice_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_relations_to
    ON invoices.invoice_relations(to_invoice_id, relation_type)
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_relations_single_cancellation
    ON invoices.invoice_relations(workspace_id, to_invoice_id)
    WHERE relation_type = 'cancels'
  `.simple();
  console.log("  ✓ invoices.invoice_relations table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_external_refs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      invoice_id UUID NOT NULL REFERENCES invoices.invoices(id) ON DELETE CASCADE,
      source_app TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_version TEXT,
      payload_hash TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, source_app, source_type, source_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_external_refs_invoice
    ON invoices.invoice_external_refs(invoice_id)
  `.simple();
  console.log("  ✓ invoices.invoice_external_refs table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_idempotency_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_ref TEXT,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('started', 'completed', 'failed')),
      created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,
      UNIQUE (workspace_id, operation, idempotency_key)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_idempotency_expires
    ON invoices.invoice_idempotency_keys(expires_at)
    WHERE expires_at IS NOT NULL
  `.simple();
  console.log("  ✓ invoices.invoice_idempotency_keys table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_artifacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices.invoices(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL,
      profile TEXT NOT NULL,
      profile_version TEXT,
      syntax TEXT,
      mime_type TEXT NOT NULL,
      storage_ref TEXT,
      sha256 TEXT,
      byte_size BIGINT,
      validation_status TEXT NOT NULL DEFAULT 'generated'
        CHECK (validation_status IN ('generated', 'valid', 'invalid')),
      validation_report JSONB NOT NULL DEFAULT '{}'::jsonb,
      validator_bundle_version TEXT,
      validated_at TIMESTAMPTZ,
      buyer_reference TEXT,
      leitweg_id TEXT,
      template_version_id UUID REFERENCES invoices.invoice_template_versions(id) ON DELETE RESTRICT,
      invoice_version INT NOT NULL,
      supersedes_artifact_id UUID REFERENCES invoices.invoice_artifacts(id) ON DELETE SET NULL,
      created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (artifact_type IN ('xrechnung_xml', 'zugferd_pdf', 'pdf_preview')),
      CHECK (
        (artifact_type = 'xrechnung_xml' AND mime_type = 'application/xml')
        OR (artifact_type IN ('zugferd_pdf', 'pdf_preview') AND mime_type = 'application/pdf')
      ),
      CHECK (
        storage_ref IS NOT NULL
        AND sha256 IS NOT NULL
        AND byte_size IS NOT NULL
        AND byte_size > 0
      ),
      CHECK (validation_status <> 'valid' OR validated_at IS NOT NULL)
    )
  `.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts ADD COLUMN IF NOT EXISTS profile_version TEXT`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts ADD COLUMN IF NOT EXISTS syntax TEXT`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts ADD COLUMN IF NOT EXISTS validator_bundle_version TEXT`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts ADD COLUMN IF NOT EXISTS buyer_reference TEXT`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts ADD COLUMN IF NOT EXISTS leitweg_id TEXT`.simple();
  await sql`DROP TRIGGER IF EXISTS reject_invoice_artifacts_mutation ON invoices.invoice_artifacts`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts ALTER COLUMN validation_status SET DEFAULT 'generated'`.simple();
  await sql`
    UPDATE invoices.invoice_artifacts
    SET validation_status = 'invalid'
    WHERE validation_status IN ('pending', 'failed')
  `.simple();
  await sql`
    DELETE FROM invoices.invoice_artifacts
    WHERE storage_ref IS NULL
      OR sha256 IS NULL
      OR byte_size IS NULL
      OR byte_size <= 0
  `.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts DROP CONSTRAINT IF EXISTS invoice_artifacts_validation_status_check`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts DROP CONSTRAINT IF EXISTS invoice_artifacts_final_content_check`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts DROP CONSTRAINT IF EXISTS invoice_artifacts_validated_at_check`.simple();
  await sql`ALTER TABLE invoices.invoice_artifacts DROP CONSTRAINT IF EXISTS invoice_artifacts_sha256_format_check`.simple();
  await sql`
    ALTER TABLE invoices.invoice_artifacts
    ADD CONSTRAINT invoice_artifacts_validation_status_check
    CHECK (validation_status IN ('generated', 'valid', 'invalid'))
  `.simple().catch((error: unknown) => {
    const dbError = error as { code?: string; errno?: string };
    if (dbError.code !== "42710" && dbError.errno !== "42710") throw error;
  });
  await sql`
    ALTER TABLE invoices.invoice_artifacts
    ADD CONSTRAINT invoice_artifacts_type_check
    CHECK (artifact_type IN ('xrechnung_xml', 'zugferd_pdf', 'pdf_preview'))
  `.simple().catch((error: unknown) => {
    const dbError = error as { code?: string; errno?: string };
    if (dbError.code !== "42710" && dbError.errno !== "42710") throw error;
  });
  await sql`
    ALTER TABLE invoices.invoice_artifacts
    ADD CONSTRAINT invoice_artifacts_mime_type_check
    CHECK (
      (artifact_type = 'xrechnung_xml' AND mime_type = 'application/xml')
      OR (artifact_type IN ('zugferd_pdf', 'pdf_preview') AND mime_type = 'application/pdf')
    )
  `.simple().catch((error: unknown) => {
    const dbError = error as { code?: string; errno?: string };
    if (dbError.code !== "42710" && dbError.errno !== "42710") throw error;
  });
  await sql`
    ALTER TABLE invoices.invoice_artifacts
    ADD CONSTRAINT invoice_artifacts_final_content_check
    CHECK (
      storage_ref IS NOT NULL
      AND sha256 IS NOT NULL
      AND byte_size IS NOT NULL
      AND byte_size > 0
    )
  `.simple().catch((error: unknown) => {
    const dbError = error as { code?: string; errno?: string };
    if (dbError.code !== "42710" && dbError.errno !== "42710") throw error;
  });
  await sql`
    ALTER TABLE invoices.invoice_artifacts
    ADD CONSTRAINT invoice_artifacts_validated_at_check
    CHECK (validation_status <> 'valid' OR validated_at IS NOT NULL)
  `.simple().catch((error: unknown) => {
    const dbError = error as { code?: string; errno?: string };
    if (dbError.code !== "42710" && dbError.errno !== "42710") throw error;
  });
  await sql`
    ALTER TABLE invoices.invoice_artifacts
    ADD CONSTRAINT invoice_artifacts_sha256_format_check
    CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$')
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_artifacts_invoice
    ON invoices.invoice_artifacts(invoice_id, artifact_type, created_at DESC)
  `.simple();
  await sql`DROP INDEX IF EXISTS invoices.idx_invoice_artifacts_unique_hash`.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_artifacts_unique_hash_status
    ON invoices.invoice_artifacts(invoice_id, artifact_type, sha256, validation_status)
    WHERE sha256 IS NOT NULL
  `.simple();
  await sql`
    CREATE OR REPLACE FUNCTION invoices.enforce_artifact_supersedes_match()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      superseded_invoice_id UUID;
      superseded_artifact_type TEXT;
    BEGIN
      IF NEW.supersedes_artifact_id IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT invoice_id, artifact_type
      INTO superseded_invoice_id, superseded_artifact_type
      FROM invoices.invoice_artifacts
      WHERE id = NEW.supersedes_artifact_id;

      IF superseded_invoice_id IS NULL THEN
        RAISE EXCEPTION 'Superseded artifact does not exist'
          USING ERRCODE = '23514';
      END IF;

      IF superseded_invoice_id IS DISTINCT FROM NEW.invoice_id
        OR superseded_artifact_type IS DISTINCT FROM NEW.artifact_type
      THEN
        RAISE EXCEPTION 'Superseded artifact must belong to the same invoice and artifact type'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $$;
  `.simple();
  await sql`DROP TRIGGER IF EXISTS enforce_artifact_supersedes_match ON invoices.invoice_artifacts`.simple();
  await sql`
    CREATE TRIGGER enforce_artifact_supersedes_match
    BEFORE INSERT OR UPDATE ON invoices.invoice_artifacts
    FOR EACH ROW
    EXECUTE FUNCTION invoices.enforce_artifact_supersedes_match()
  `.simple();
  console.log("  ✓ invoices.invoice_artifacts table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_export_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      export_type TEXT NOT NULL CHECK (export_type IN ('pdf_zip', 'summary_csv', 'datev_csv')),
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
      filter_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      selected_invoice_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
      format_version TEXT NOT NULL,
      generator_version TEXT NOT NULL,
      manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
      file_sha256 TEXT,
      file_size BIGINT,
      created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[a-f0-9]{64}$'),
      CHECK (file_size IS NULL OR file_size > 0),
      CHECK (completed_at IS NOT NULL),
      CHECK (status <> 'completed' OR (file_sha256 IS NOT NULL AND file_size IS NOT NULL))
    )
  `.simple();
  await sql`
    ALTER TABLE invoices.invoice_export_batches
    ALTER COLUMN status SET DEFAULT 'completed'
  `.simple();
  await sql`
    UPDATE invoices.invoice_export_batches
    SET status = 'failed'
    WHERE status = 'created'
  `.simple();
  await sql`
    UPDATE invoices.invoice_export_batches
    SET completed_at = created_at
    WHERE completed_at IS NULL
  `.simple();
  await sql`
    ALTER TABLE invoices.invoice_export_batches
    ALTER COLUMN completed_at SET NOT NULL
  `.simple();
  await sql`
    ALTER TABLE invoices.invoice_export_batches
    ADD CONSTRAINT invoice_export_batches_final_status_check
    CHECK (status IN ('completed', 'failed'))
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_export_batches
    ADD CONSTRAINT invoice_export_batches_completed_file_check
    CHECK (status <> 'completed' OR (file_sha256 IS NOT NULL AND file_size IS NOT NULL))
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_export_batches_workspace
    ON invoices.invoice_export_batches(workspace_id, created_at DESC)
  `.simple();
  console.log("  ✓ invoices.invoice_export_batches table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_export_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID NOT NULL REFERENCES invoices.invoice_export_batches(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      invoice_id UUID NOT NULL REFERENCES invoices.invoices(id) ON DELETE RESTRICT,
      artifact_id UUID REFERENCES invoices.invoice_artifacts(id) ON DELETE SET NULL,
      row_number INT NOT NULL CHECK (row_number > 0),
      row_hash TEXT NOT NULL CHECK (row_hash ~ '^[a-f0-9]{64}$'),
      amount_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      tax_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      accounting_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'included' CHECK (status IN ('included', 'skipped', 'failed')),
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (batch_id, row_number)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_export_items_batch
    ON invoices.invoice_export_items(batch_id, row_number)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_export_items_invoice
    ON invoices.invoice_export_items(invoice_id)
  `.simple();
  console.log("  ✓ invoices.invoice_export_items table");

  await sql`
    CREATE TABLE IF NOT EXISTS invoices.invoice_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES invoices.invoice_workspaces(id) ON DELETE CASCADE,
      invoice_id UUID REFERENCES invoices.invoices(id) ON DELETE CASCADE,
      seq BIGSERIAL NOT NULL,
      event_type TEXT NOT NULL,
      actor_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      source_app TEXT,
      idempotency_key TEXT,
      previous_status TEXT,
      next_status TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice
    ON invoices.invoice_events(invoice_id, seq)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_events_workspace
    ON invoices.invoice_events(workspace_id, created_at DESC)
  `.simple();
  console.log("  ✓ invoices.invoice_events table");

  await sql`DROP TRIGGER IF EXISTS reject_issued_invoice_header_mutation ON invoices.invoices`.simple();
  await sql`
    UPDATE invoices.invoices
    SET service_period_start = COALESCE(service_period_start, issue_date, CURRENT_DATE)
    WHERE status = 'issued'
      AND service_period_start IS NULL
  `.simple();
  await sql`
    UPDATE invoices.invoices
    SET service_period_end = service_period_start
    WHERE status = 'issued'
      AND service_period_start IS NOT NULL
      AND service_period_end IS NULL
  `.simple();
  await sql`
    UPDATE invoices.invoices
    SET service_period_end = service_period_start
    WHERE service_period_start IS NOT NULL
      AND service_period_end IS NOT NULL
      AND service_period_end < service_period_start
  `.simple();

  await sql`
    ALTER TABLE invoices.invoice_issuer_profiles
    ADD CONSTRAINT invoice_issuer_profiles_id_workspace_unique UNIQUE (id, workspace_id)
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_sequences
    ADD CONSTRAINT invoice_sequences_id_workspace_unique UNIQUE (id, workspace_id)
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_sequences
    ADD CONSTRAINT invoice_sequences_id_workspace_document_type_unique UNIQUE (id, workspace_id, document_type)
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_sequences
    ADD CONSTRAINT invoice_sequences_id_issuer_unique UNIQUE (id, issuer_profile_id)
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_templates
    ADD CONSTRAINT invoice_templates_id_workspace_unique UNIQUE (id, workspace_id)
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_template_versions
    ADD CONSTRAINT invoice_template_versions_id_template_unique UNIQUE (id, template_id)
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_id_workspace_unique UNIQUE (id, workspace_id)
  `.simple().catch(ignoreDuplicateConstraint);

  await sql`
    ALTER TABLE invoices.invoice_sequences
    ADD CONSTRAINT invoice_sequences_issuer_workspace_fk
    FOREIGN KEY (issuer_profile_id, workspace_id)
    REFERENCES invoices.invoice_issuer_profiles(id, workspace_id)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_templates
    ADD CONSTRAINT invoice_templates_issuer_workspace_fk
    FOREIGN KEY (issuer_profile_id, workspace_id)
    REFERENCES invoices.invoice_issuer_profiles(id, workspace_id)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_template_versions
    ADD CONSTRAINT invoice_template_versions_sequence_issuer_fk
    FOREIGN KEY (number_sequence_id, issuer_profile_id)
    REFERENCES invoices.invoice_sequences(id, issuer_profile_id)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_templates
    ADD CONSTRAINT invoice_templates_active_version_template_fk
    FOREIGN KEY (active_version_id, id)
    REFERENCES invoices.invoice_template_versions(id, template_id)
    DEFERRABLE INITIALLY DEFERRED
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_template_workspace_fk
    FOREIGN KEY (template_id, workspace_id)
    REFERENCES invoices.invoice_templates(id, workspace_id)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_issuer_workspace_fk
    FOREIGN KEY (issuer_profile_id, workspace_id)
    REFERENCES invoices.invoice_issuer_profiles(id, workspace_id)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_sequence_workspace_fk
    FOREIGN KEY (sequence_id, workspace_id)
    REFERENCES invoices.invoice_sequences(id, workspace_id)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    UPDATE invoices.invoices i
    SET document_type = s.document_type
    FROM invoices.invoice_sequences s
    WHERE i.status = 'draft'
      AND i.sequence_id = s.id
      AND i.workspace_id = s.workspace_id
      AND i.document_type <> s.document_type
  `.simple();
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_sequence_document_type_fk
    FOREIGN KEY (sequence_id, workspace_id, document_type)
    REFERENCES invoices.invoice_sequences(id, workspace_id, document_type)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_template_version_template_fk
    FOREIGN KEY (template_version_id, template_id)
    REFERENCES invoices.invoice_template_versions(id, template_id)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_relations
    ADD CONSTRAINT invoice_relations_from_invoice_workspace_fk
    FOREIGN KEY (from_invoice_id, workspace_id)
    REFERENCES invoices.invoices(id, workspace_id)
    ON DELETE CASCADE
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_relations
    ADD CONSTRAINT invoice_relations_to_invoice_workspace_fk
    FOREIGN KEY (to_invoice_id, workspace_id)
    REFERENCES invoices.invoices(id, workspace_id)
    ON DELETE CASCADE
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_external_refs
    ADD CONSTRAINT invoice_external_refs_invoice_workspace_fk
    FOREIGN KEY (invoice_id, workspace_id)
    REFERENCES invoices.invoices(id, workspace_id)
    ON DELETE CASCADE
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_events
    ADD CONSTRAINT invoice_events_invoice_workspace_fk
    FOREIGN KEY (invoice_id, workspace_id)
    REFERENCES invoices.invoices(id, workspace_id)
    ON DELETE CASCADE
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_export_batches
    ADD CONSTRAINT invoice_export_batches_id_workspace_unique UNIQUE (id, workspace_id)
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_export_items
    ADD COLUMN IF NOT EXISTS workspace_id UUID
  `.simple();
  await sql`
    UPDATE invoices.invoice_export_items item
    SET workspace_id = batch.workspace_id
    FROM invoices.invoice_export_batches batch
    WHERE item.batch_id = batch.id
      AND item.workspace_id IS NULL
  `.simple();
  await sql`
    ALTER TABLE invoices.invoice_export_items
    ALTER COLUMN workspace_id SET NOT NULL
  `.simple();
  await sql`
    ALTER TABLE invoices.invoice_export_items
    ADD CONSTRAINT invoice_export_items_batch_workspace_fk
    FOREIGN KEY (batch_id, workspace_id)
    REFERENCES invoices.invoice_export_batches(id, workspace_id)
    ON DELETE CASCADE
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_export_items
    ADD CONSTRAINT invoice_export_items_invoice_workspace_fk
    FOREIGN KEY (invoice_id, workspace_id)
    REFERENCES invoices.invoices(id, workspace_id)
    ON DELETE RESTRICT
  `.simple().catch(ignoreDuplicateConstraint);

  await sql`ALTER TABLE invoices.invoices DROP CONSTRAINT IF EXISTS invoices_issued_required_fields_check`.simple();
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_issued_required_fields_check
    CHECK (
      status <> 'issued'
      OR (
        invoice_number IS NOT NULL
        AND issued_at IS NOT NULL
        AND template_version_id IS NOT NULL
        AND sequence_id IS NOT NULL
        AND issue_date IS NOT NULL
        AND service_period_start IS NOT NULL
        AND service_period_end IS NOT NULL
      )
    )
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_service_period_order_check
    CHECK (
      service_period_start IS NULL
      OR service_period_end IS NULL
      OR service_period_end >= service_period_start
    )
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoices
    ADD CONSTRAINT invoices_totals_check
    CHECK (
      subtotal_net_cents >= 0
      AND tax_total_cents >= 0
      AND total_gross_cents >= 0
      AND total_gross_cents = subtotal_net_cents + tax_total_cents + rounding_delta_cents
    )
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_lines
    ADD CONSTRAINT invoice_lines_kind_check
    CHECK (kind IN ('item'))
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_lines
    ADD CONSTRAINT invoice_lines_totals_check
    CHECK (
      tax_rate_bps >= 0
      AND tax_rate_bps <= 10000
      AND total_net_cents >= 0
      AND total_tax_cents >= 0
      AND total_gross_cents >= 0
      AND total_gross_cents = total_net_cents + total_tax_cents
    )
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_tax_breakdowns
    ADD CONSTRAINT invoice_tax_breakdowns_amounts_check
    CHECK (
      tax_rate_bps >= 0
      AND tax_rate_bps <= 10000
      AND taxable_amount_cents >= 0
      AND tax_amount_cents >= 0
    )
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_external_refs
    ADD CONSTRAINT invoice_external_refs_source_fields_check
    CHECK (
      btrim(source_app) <> ''
      AND btrim(source_type) <> ''
      AND btrim(source_id) <> ''
    )
  `.simple().catch(ignoreDuplicateConstraint);
  await sql`
    ALTER TABLE invoices.invoice_external_refs
    ADD CONSTRAINT invoice_external_refs_payload_hash_nonempty_check
    CHECK (btrim(payload_hash) <> '')
  `.simple().catch(ignoreDuplicateConstraint);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_template_versions_issuer
    ON invoices.invoice_template_versions(issuer_profile_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_template_versions_sequence
    ON invoices.invoice_template_versions(number_sequence_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_issuer
    ON invoices.invoices(issuer_profile_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_sequence
    ON invoices.invoices(sequence_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_template_version
    ON invoices.invoices(template_version_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_relations_from
    ON invoices.invoice_relations(from_invoice_id, relation_type)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_external_refs_workspace_invoice
    ON invoices.invoice_external_refs(workspace_id, invoice_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_events_workspace_invoice
    ON invoices.invoice_events(workspace_id, invoice_id)
  `.simple();
  console.log("  ✓ invoices relational integrity constraints");

  await sql`
    CREATE OR REPLACE FUNCTION invoices.reject_issued_invoice_header_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND OLD.status = 'issued' THEN
        RAISE EXCEPTION 'Issued invoices cannot be deleted'
          USING ERRCODE = '23514';
      END IF;

      IF TG_OP = 'UPDATE'
        AND OLD.status = 'issued'
        AND (
          NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
          NEW.document_type IS DISTINCT FROM OLD.document_type OR
          NEW.status IS DISTINCT FROM OLD.status OR
          NEW.template_id IS DISTINCT FROM OLD.template_id OR
          NEW.template_version_id IS DISTINCT FROM OLD.template_version_id OR
          NEW.issuer_profile_id IS DISTINCT FROM OLD.issuer_profile_id OR
          NEW.sequence_id IS DISTINCT FROM OLD.sequence_id OR
          NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR
          NEW.contact_id IS DISTINCT FROM OLD.contact_id OR
          NEW.source IS DISTINCT FROM OLD.source OR
          NEW.issue_date IS DISTINCT FROM OLD.issue_date OR
          NEW.due_date IS DISTINCT FROM OLD.due_date OR
          NEW.service_period_start IS DISTINCT FROM OLD.service_period_start OR
          NEW.service_period_end IS DISTINCT FROM OLD.service_period_end OR
          NEW.currency IS DISTINCT FROM OLD.currency OR
          NEW.subtotal_net_cents IS DISTINCT FROM OLD.subtotal_net_cents OR
          NEW.tax_total_cents IS DISTINCT FROM OLD.tax_total_cents OR
          NEW.total_gross_cents IS DISTINCT FROM OLD.total_gross_cents OR
          NEW.rounding_delta_cents IS DISTINCT FROM OLD.rounding_delta_cents OR
          NEW.payment_status IS DISTINCT FROM OLD.payment_status OR
          NEW.compliance_snapshot IS DISTINCT FROM OLD.compliance_snapshot OR
          NEW.version IS DISTINCT FROM OLD.version OR
          NEW.created_by IS DISTINCT FROM OLD.created_by OR
          NEW.updated_by IS DISTINCT FROM OLD.updated_by OR
          NEW.issued_by IS DISTINCT FROM OLD.issued_by OR
          NEW.created_at IS DISTINCT FROM OLD.created_at OR
          NEW.updated_at IS DISTINCT FROM OLD.updated_at OR
          NEW.issued_at IS DISTINCT FROM OLD.issued_at
        )
      THEN
        RAISE EXCEPTION 'Issued invoice header fields are immutable'
          USING ERRCODE = '23514';
      END IF;

      RETURN COALESCE(NEW, OLD);
    END;
    $$;
  `.simple();
  await sql`DROP TRIGGER IF EXISTS reject_issued_invoice_header_mutation ON invoices.invoices`.simple();
  await sql`
    CREATE TRIGGER reject_issued_invoice_header_mutation
    BEFORE UPDATE OR DELETE ON invoices.invoices
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_issued_invoice_header_mutation()
  `.simple();

  await sql`
    CREATE OR REPLACE FUNCTION invoices.reject_issued_invoice_child_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      old_status TEXT;
      new_status TEXT;
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.invoice_id IS NOT NULL THEN
        SELECT status INTO old_status
        FROM invoices.invoices
        WHERE id = OLD.invoice_id;
      END IF;

      IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.invoice_id IS NOT NULL THEN
        SELECT status INTO new_status
        FROM invoices.invoices
        WHERE id = NEW.invoice_id;
      END IF;

      IF old_status = 'issued' OR new_status = 'issued' THEN
        RAISE EXCEPTION 'Issued invoice child rows are immutable'
          USING ERRCODE = '23514';
      END IF;

      IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
        RAISE EXCEPTION 'Invoice child rows cannot be reassigned'
          USING ERRCODE = '23514';
      END IF;

      RETURN COALESCE(NEW, OLD);
    END;
    $$;
  `.simple();

  await sql`DROP TRIGGER IF EXISTS reject_issued_invoice_lines_mutation ON invoices.invoice_lines`.simple();
  await sql`
    CREATE TRIGGER reject_issued_invoice_lines_mutation
    BEFORE INSERT OR UPDATE OR DELETE ON invoices.invoice_lines
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_issued_invoice_child_mutation()
  `.simple();

  await sql`DROP TRIGGER IF EXISTS reject_issued_invoice_party_mutation ON invoices.invoice_party_snapshots`.simple();
  await sql`
    CREATE TRIGGER reject_issued_invoice_party_mutation
    BEFORE INSERT OR UPDATE OR DELETE ON invoices.invoice_party_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_issued_invoice_child_mutation()
  `.simple();

  await sql`DROP TRIGGER IF EXISTS reject_issued_invoice_tax_mutation ON invoices.invoice_tax_breakdowns`.simple();
  await sql`
    CREATE TRIGGER reject_issued_invoice_tax_mutation
    BEFORE INSERT OR UPDATE OR DELETE ON invoices.invoice_tax_breakdowns
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_issued_invoice_child_mutation()
  `.simple();

  await sql`
    CREATE OR REPLACE FUNCTION invoices.reject_append_only_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
        USING ERRCODE = '23514';
    END;
    $$
  `.simple();
  await sql`DROP TRIGGER IF EXISTS reject_invoice_events_mutation ON invoices.invoice_events`.simple();
  await sql`
    CREATE TRIGGER reject_invoice_events_mutation
    BEFORE UPDATE OR DELETE ON invoices.invoice_events
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_append_only_mutation()
  `.simple();
  await sql`DROP TRIGGER IF EXISTS reject_invoice_artifacts_mutation ON invoices.invoice_artifacts`.simple();
  await sql`
    CREATE TRIGGER reject_invoice_artifacts_mutation
    BEFORE UPDATE OR DELETE ON invoices.invoice_artifacts
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_append_only_mutation()
  `.simple();
  await sql`DROP TRIGGER IF EXISTS reject_invoice_external_refs_mutation ON invoices.invoice_external_refs`.simple();
  await sql`
    CREATE TRIGGER reject_invoice_external_refs_mutation
    BEFORE UPDATE OR DELETE ON invoices.invoice_external_refs
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_append_only_mutation()
  `.simple();
  await sql`DROP TRIGGER IF EXISTS reject_invoice_export_batches_mutation ON invoices.invoice_export_batches`.simple();
  await sql`
    CREATE TRIGGER reject_invoice_export_batches_mutation
    BEFORE UPDATE OR DELETE ON invoices.invoice_export_batches
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_append_only_mutation()
  `.simple();
  await sql`DROP TRIGGER IF EXISTS reject_invoice_export_items_mutation ON invoices.invoice_export_items`.simple();
  await sql`
    CREATE TRIGGER reject_invoice_export_items_mutation
    BEFORE UPDATE OR DELETE ON invoices.invoice_export_items
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_append_only_mutation()
  `.simple();

  await sql`
    CREATE OR REPLACE FUNCTION invoices.reject_locked_template_version_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      version_in_use BOOLEAN;
    BEGIN
      SELECT EXISTS (
        SELECT 1
        FROM invoices.invoices
        WHERE template_version_id = OLD.id
      ) INTO version_in_use;

      IF TG_OP = 'DELETE' AND (OLD.activated_at IS NOT NULL OR version_in_use) THEN
        RAISE EXCEPTION 'Activated or used invoice template versions cannot be deleted'
          USING ERRCODE = '23514';
      END IF;

      IF TG_OP = 'UPDATE'
        AND OLD.activated_at IS NULL
        AND NEW.activated_at IS NOT NULL
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.template_id IS NOT DISTINCT FROM OLD.template_id
        AND NEW.version IS NOT DISTINCT FROM OLD.version
        AND NEW.name_snapshot IS NOT DISTINCT FROM OLD.name_snapshot
        AND NEW.issuer_profile_id IS NOT DISTINCT FROM OLD.issuer_profile_id
        AND NEW.number_sequence_id IS NOT DISTINCT FROM OLD.number_sequence_id
        AND NEW.payment_terms_days IS NOT DISTINCT FROM OLD.payment_terms_days
        AND NEW.currency IS NOT DISTINCT FROM OLD.currency
        AND NEW.tax_defaults IS NOT DISTINCT FROM OLD.tax_defaults
        AND NEW.layout_settings IS NOT DISTINCT FROM OLD.layout_settings
        AND NEW.e_invoice_defaults IS NOT DISTINCT FROM OLD.e_invoice_defaults
        AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      THEN
        RETURN NEW;
      END IF;

      IF TG_OP = 'UPDATE' AND (OLD.activated_at IS NOT NULL OR version_in_use) THEN
        RAISE EXCEPTION 'Activated or used invoice template versions are immutable'
          USING ERRCODE = '23514';
      END IF;

      RETURN COALESCE(NEW, OLD);
    END;
    $$;
  `.simple();
  await sql`DROP TRIGGER IF EXISTS reject_locked_template_version_mutation ON invoices.invoice_template_versions`.simple();
  await sql`
    CREATE TRIGGER reject_locked_template_version_mutation
    BEFORE UPDATE OR DELETE ON invoices.invoice_template_versions
    FOR EACH ROW
    EXECUTE FUNCTION invoices.reject_locked_template_version_mutation()
  `.simple();
  console.log("  ✓ invoices issued invoice immutability guards");
};
