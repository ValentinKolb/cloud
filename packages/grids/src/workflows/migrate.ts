import type { SQL } from "bun";

const WORKFLOW_KERNEL_SCHEMA_VERSION = 1;

const resetAlphaWorkflowSchema = async (sql: SQL): Promise<boolean> => {
  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_kernel_migrations (
      version INT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();

  const [migration] = await sql<Array<{ applied: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM grids.workflow_kernel_migrations WHERE version = ${WORKFLOW_KERNEL_SCHEMA_VERSION}
    ) AS applied
  `;
  if (migration?.applied) return false;

  // Workflows are local alpha data. Reset only their schema; document and scan
  // records remain intact and are reconnected after the new tables exist.
  await sql`
    ALTER TABLE grids.document_runs DROP CONSTRAINT IF EXISTS document_runs_workflow_run_id_fkey;
    UPDATE grids.document_runs SET workflow_run_id = NULL WHERE workflow_run_id IS NOT NULL;
    DROP TABLE IF EXISTS grids.workflow_effect_intents CASCADE;
    DROP TABLE IF EXISTS grids.workflow_email_deliveries CASCADE;
    DROP TABLE IF EXISTS grids.workflow_step_runs CASCADE;
    DROP TABLE IF EXISTS grids.workflow_runs CASCADE;
    DROP TABLE IF EXISTS grids.workflow_launchers CASCADE;
    DROP TABLE IF EXISTS grids.workflow_access CASCADE;
    DROP TABLE IF EXISTS grids.workflows CASCADE;
    DROP FUNCTION IF EXISTS grids.populate_workflow_run_snapshots();
    DROP FUNCTION IF EXISTS grids.bump_workflow_revision();
  `.simple();
  return true;
};

const migrateDefinitions = async (sql: SQL): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL,
      plan JSONB NOT NULL,
      diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      position INT NOT NULL DEFAULT 0,
      revision INT NOT NULL DEFAULT 1,
      record_event_active_since TIMESTAMPTZ,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT workflows_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$'),
      CONSTRAINT workflows_revision_chk CHECK (revision >= 1),
      CONSTRAINT workflows_source_length_chk CHECK (length(source) BETWEEN 1 AND 200000),
      CONSTRAINT workflows_diagnostics_array_chk CHECK (jsonb_typeof(diagnostics) = 'array')
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_workflows_short_id
    ON grids.workflows(base_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflows_base_live
    ON grids.workflows(base_id, position, created_at, id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflows_automatic
    ON grids.workflows(base_id, record_event_active_since)
    WHERE deleted_at IS NULL AND enabled = TRUE
  `.simple();

  await sql`
    CREATE OR REPLACE FUNCTION grids.bump_workflow_revision()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.revision := OLD.revision + 1;
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.simple();
  await sql`DROP TRIGGER IF EXISTS bump_workflow_revision ON grids.workflows`.simple();
  await sql`
    CREATE TRIGGER bump_workflow_revision
    BEFORE UPDATE ON grids.workflows
    FOR EACH ROW EXECUTE FUNCTION grids.bump_workflow_revision()
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_access (
      workflow_id UUID NOT NULL REFERENCES grids.workflows(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (workflow_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_grids_workflow_access_access ON grids.workflow_access(access_id)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_launchers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      short_id TEXT NOT NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL REFERENCES grids.workflows(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('scanner', 'bulk', 'dashboard')),
      config JSONB NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      validated_revision INT NOT NULL CHECK (validated_revision >= 1),
      diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT workflow_launchers_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$'),
      CONSTRAINT workflow_launchers_diagnostics_array_chk CHECK (jsonb_typeof(diagnostics) = 'array')
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_workflow_launchers_short_id
    ON grids.workflow_launchers(base_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_launchers_workflow
    ON grids.workflow_launchers(workflow_id, kind, created_at, id) WHERE deleted_at IS NULL
  `.simple();
};

const migrateRuns = async (sql: SQL): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID REFERENCES grids.workflows(id) ON DELETE SET NULL,
      launcher_id UUID REFERENCES grids.workflow_launchers(id) ON DELETE SET NULL,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      workflow_revision INT NOT NULL CHECK (workflow_revision >= 1),
      mode TEXT NOT NULL CHECK (mode IN ('execute', 'dryRun')),
      channel TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      service_account_id UUID REFERENCES auth.service_accounts(id) ON DELETE SET NULL,
      actor_service_account_id UUID,
      credential_kind TEXT,
      credential_id UUID,
      credential_scopes TEXT[] NOT NULL DEFAULT '{}',
      credential_permission_cap TEXT,
      credential_expires_at TIMESTAMPTZ,
      credential_resource_app_id TEXT,
      credential_resource_type TEXT,
      credential_resource_id TEXT,
      actor_group_ids UUID[] NOT NULL DEFAULT '{}',
      authorization_snapshot JSONB NOT NULL DEFAULT '{"kind":"workflow"}'::jsonb,
      inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      workflow_plan JSONB NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'needs_attention')),
      result JSONB,
      error JSONB,
      result_message TEXT,
      occurred_at TIMESTAMPTZ NOT NULL,
      execution_clock_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      lease_expires_at TIMESTAMPTZ,
      execution_generation INT NOT NULL DEFAULT 0 CHECK (execution_generation >= 0),
      queue_attempts INT NOT NULL DEFAULT 0 CHECK (queue_attempts >= 0),
      last_queue_attempt_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      CONSTRAINT workflow_runs_idempotency_key_length_chk CHECK (length(idempotency_key) BETWEEN 1 AND 200)
    )
  `.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS actor_service_account_id UUID`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS credential_kind TEXT`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS credential_id UUID`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS credential_scopes TEXT[] NOT NULL DEFAULT '{}'`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS credential_permission_cap TEXT`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS credential_expires_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS credential_resource_app_id TEXT`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS credential_resource_type TEXT`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS credential_resource_id TEXT`.simple();
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS execution_clock_at TIMESTAMPTZ NOT NULL DEFAULT now()`.simple();
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'grids'
          AND table_name = 'workflow_runs'
          AND column_name = 'credential_permission_cap'
          AND data_type = 'USER-DEFINED'
      ) THEN
        ALTER TABLE grids.workflow_runs
          ALTER COLUMN credential_permission_cap TYPE TEXT USING credential_permission_cap::text;
      END IF;
    END $$
  `.simple();
  await sql`UPDATE grids.workflow_runs SET channel = 'api' WHERE channel IN ('manual', 'cli', 'agent')`.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workflow_runs_credential_kind_chk'
          AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.workflow_runs
          ADD CONSTRAINT workflow_runs_credential_kind_chk
          CHECK (credential_kind IS NULL OR credential_kind IN ('api_token', 'oauth'));
      END IF;
    END $$
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workflow_runs_credential_permission_cap_chk'
          AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.workflow_runs
          ADD CONSTRAINT workflow_runs_credential_permission_cap_chk
          CHECK (credential_permission_cap IS NULL OR credential_permission_cap IN ('none', 'read', 'write', 'admin'));
      END IF;
    END $$
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workflow_runs_channel_chk'
          AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.workflow_runs
          ADD CONSTRAINT workflow_runs_channel_chk
          CHECK (channel IN ('api', 'dashboard', 'scanner', 'bulk', 'schedule', 'recordEvent'));
      END IF;
    END $$
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_workflow_runs_idempotency
    ON grids.workflow_runs(workflow_id, mode, channel, idempotency_key)
    WHERE workflow_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_runs_workflow
    ON grids.workflow_runs(workflow_id, created_at DESC, id DESC) WHERE workflow_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_runs_base
    ON grids.workflow_runs(base_id, created_at DESC, id DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_runs_recovery
    ON grids.workflow_runs(status, lease_expires_at, last_queue_attempt_at, created_at)
    WHERE status IN ('queued', 'running')
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_step_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES grids.workflow_runs(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      source_path JSONB NOT NULL,
      iteration_path INT[] NOT NULL DEFAULT '{}',
      kind TEXT NOT NULL,
      action TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('execute', 'dryRun')),
      status TEXT NOT NULL CHECK (
        status IN ('running', 'waiting', 'succeeded', 'failed', 'canceled', 'needs_attention', 'unsupported', 'indeterminate')
      ),
      outcome JSONB,
      execution_generation INT NOT NULL CHECK (execution_generation >= 0),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      UNIQUE (run_id, step_key)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_step_runs_run
    ON grids.workflow_step_runs(run_id, started_at, id)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_effect_intents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES grids.workflow_runs(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      effect_kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'executing', 'succeeded', 'failed', 'needs_attention')),
      request JSONB NOT NULL,
      result JSONB,
      error JSONB,
      attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (idempotency_key)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_effect_intents_run
    ON grids.workflow_effect_intents(run_id, step_key, created_at)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_effect_intents_recovery
    ON grids.workflow_effect_intents(status, updated_at)
    WHERE status IN ('pending', 'executing')
  `.simple();
};

const migrateDeliveries = async (sql: SQL): Promise<void> => {
  await sql`ALTER TABLE grids.document_runs ADD COLUMN IF NOT EXISTS workflow_step_key TEXT`.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_document_runs_workflow_step
    ON grids.document_runs(workflow_run_id, workflow_step_key)
    WHERE workflow_run_id IS NOT NULL AND workflow_step_key IS NOT NULL
  `.simple();
  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_email_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      workflow_id UUID REFERENCES grids.workflows(id) ON DELETE SET NULL,
      workflow_run_id UUID REFERENCES grids.workflow_runs(id) ON DELETE SET NULL,
      workflow_step_run_id UUID REFERENCES grids.workflow_step_runs(id) ON DELETE SET NULL,
      template_id UUID REFERENCES grids.email_templates(id) ON DELETE SET NULL,
      recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('email', 'user')),
      recipient_value TEXT,
      recipient_summary TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      notification_id UUID,
      provider_status TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
      subject TEXT,
      rendered_html TEXT,
      error TEXT,
      recipient_index INT NOT NULL CHECK (recipient_index > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (idempotency_key),
      UNIQUE (workflow_step_run_id, recipient_index)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_email_deliveries_base
    ON grids.workflow_email_deliveries(base_id, created_at DESC, id DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_email_deliveries_run
    ON grids.workflow_email_deliveries(workflow_run_id, created_at, id) WHERE workflow_run_id IS NOT NULL
  `.simple();

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_runs_workflow_run_id_fkey'
          AND connamespace = 'grids'::regnamespace
      ) THEN
        ALTER TABLE grids.document_runs
          ADD CONSTRAINT document_runs_workflow_run_id_fkey
          FOREIGN KEY (workflow_run_id) REFERENCES grids.workflow_runs(id) ON DELETE SET NULL;
      END IF;
    END $$
  `.simple();
};

export const migrateWorkflowKernel = async (sql: SQL): Promise<void> => {
  const didReset = await resetAlphaWorkflowSchema(sql);
  await migrateDefinitions(sql);
  await migrateRuns(sql);
  await migrateDeliveries(sql);
  if (didReset) {
    await sql`
      INSERT INTO grids.workflow_kernel_migrations (version)
      VALUES (${WORKFLOW_KERNEL_SCHEMA_VERSION})
      ON CONFLICT (version) DO NOTHING
    `;
  }
};
