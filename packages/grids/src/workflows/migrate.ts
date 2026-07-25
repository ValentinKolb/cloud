import type { SQL } from "bun";

export const WORKFLOW_KERNEL_SCHEMA_VERSION = 5;

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

  /*
   * Workflows are local alpha data, so the schema is reset rather than migrated.
   *
   * grids.workflows is gone for good: identity, versions and activations belong
   * to the kernel now. What it leaves behind — access grants, run options, runs
   * — is re-keyed onto grids.workflow_profile below. Documents and scan records
   * are real user data and survive; only their link back to a run is cleared.
   *
   * grids.workflow_effect_intents is gone too: a step's effect is recorded on
   * the step's own row, the way the kernel's journal does it.
   */
  await sql`
    ALTER TABLE grids.document_runs DROP CONSTRAINT IF EXISTS document_runs_workflow_run_id_fkey;
    UPDATE grids.document_runs SET workflow_run_id = NULL WHERE workflow_run_id IS NOT NULL;
    DROP TABLE IF EXISTS grids.workflow_effect_intents CASCADE;
    DROP TABLE IF EXISTS grids.workflow_email_deliveries CASCADE;
    DROP TABLE IF EXISTS grids.workflow_step_runs CASCADE;
    DROP TABLE IF EXISTS grids.workflow_runs CASCADE;
    DROP TABLE IF EXISTS grids.workflow_launchers CASCADE;
    DROP TABLE IF EXISTS grids.workflow_access CASCADE;
    DROP TABLE IF EXISTS grids.workflow_run_profile CASCADE;
    DROP TABLE IF EXISTS grids.workflow_profile CASCADE;
    DROP TABLE IF EXISTS grids.workflow_revisions CASCADE;
    DROP TABLE IF EXISTS grids.workflows CASCADE;
    DROP FUNCTION IF EXISTS grids.populate_workflow_run_snapshots();
    DROP FUNCTION IF EXISTS grids.bump_workflow_revision();
  `.simple();
  return true;
};

/**
 * Where the Grids half of a workflow will live once the kernel owns identity,
 * versions, activations, runs and the journal.
 *
 * Added ahead of the cutover and read by nothing yet, so this stays a safe
 * checkpoint: the engine below still owns every workflow.
 *
 * There is deliberately nowhere here for a draft. The editor saves on an
 * explicit action and keeps its working copy in a signal, like every other app
 * — so each save is simply a new immutable version, and an unsaved reload
 * losing its edits is the behaviour users already expect.
 *
 * Keyed by the kernel's workflow id with no foreign key to it. app-grids and
 * app-core start concurrently with no dependency declared between them, and
 * Grids' migration regularly wins on a cold database. Grids deletes the kernel
 * rows itself instead, which is why the kernel holds app_id and scope_id as
 * opaque strings rather than as references.
 */
const migrateKernelProfile = async (sql: SQL): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_profile (
      -- The kernel's workflow id. Named id because the generic access resolver
      -- joins every resource table on resource.id.
      id UUID PRIMARY KEY,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      short_id TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      /*
       * Whether this workflow may run at all — Grids policy, not the kernel's.
       *
       * The kernel only knows enabled per activation, which cannot express a
       * workflow with no triggers: those are invoked directly, and disabling
       * one has to refuse the invocation too. Grids mirrors this onto its
       * activations so the kernel's dispatcher agrees about triggers.
       */
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      -- Suppresses replay of record events older than the activation.
      record_event_active_since TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT workflow_profile_short_id_format_chk CHECK (short_id ~ '^[A-Za-z0-9]{5}$')
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grids_workflow_profile_short_id
    ON grids.workflow_profile(base_id, short_id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_profile_base_live
    ON grids.workflow_profile(base_id, position, created_at, id) WHERE deleted_at IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_profile_record_events
    ON grids.workflow_profile(base_id, record_event_active_since)
    WHERE deleted_at IS NULL AND enabled AND record_event_active_since IS NOT NULL
  `.simple();

  /*
   * Why a run happened, from Grids' point of view.
   *
   * The kernel records the cause as an event; this records what the run list
   * filters and labels by. A table rather than JSONB on the run, because those
   * are indexed predicates.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_run_profile (
      run_id UUID PRIMARY KEY,
      base_id UUID NOT NULL REFERENCES grids.bases(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL,
      launcher_id UUID,
      launcher_kind TEXT CHECK (launcher_kind IS NULL OR launcher_kind IN ('scanner', 'bulk', 'dashboard')),
      channel TEXT NOT NULL CHECK (channel IN ('api', 'dashboard', 'scanner', 'bulk', 'schedule', 'recordEvent')),
      actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      service_account_id UUID REFERENCES auth.service_accounts(id) ON DELETE SET NULL,
      -- Detects "same idempotency key, different request". The kernel answers a
      -- repeat with the first run's id, so without this a changed payload would
      -- be silently ignored rather than refused.
      request_fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_run_profile_workflow
    ON grids.workflow_run_profile(workflow_id, created_at DESC, run_id DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_run_profile_base
    ON grids.workflow_run_profile(base_id, channel, created_at DESC, run_id DESC)
  `.simple();
};

/**
 * What still hangs off a workflow, now keyed by the kernel's id.
 *
 * Access grants and run options are Grids' own — the kernel has no notion of a
 * scanner button or of who may edit a base's automation — so they stay here and
 * point at the profile.
 */
const migrateDefinitionLinks = async (sql: SQL): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS grids.workflow_access (
      workflow_id UUID NOT NULL REFERENCES grids.workflow_profile(id) ON DELETE CASCADE,
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
      workflow_id UUID NOT NULL REFERENCES grids.workflow_profile(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('scanner', 'bulk', 'dashboard')),
      config JSONB NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      -- The revision this launcher's config was checked against. Publishing a
      -- plan that may take different inputs switches it off until someone looks.
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
      workflow_id UUID,
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
      waiting_deadline TIMESTAMPTZ,
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
  await sql`ALTER TABLE grids.workflow_runs ADD COLUMN IF NOT EXISTS waiting_deadline TIMESTAMPTZ`.simple();
  await sql`
    UPDATE grids.workflow_runs
    SET waiting_deadline = (result #>> '{dependency,deadline}')::timestamptz
    WHERE status = 'waiting'
      AND waiting_deadline IS NULL
      AND result #>> '{dependency,deadline}' IS NOT NULL
  `.simple();
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
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_runs_filtered
    ON grids.workflow_runs(workflow_id, status, mode, channel, created_at DESC, id DESC)
    WHERE workflow_id IS NOT NULL
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
  await sql`DROP INDEX IF EXISTS grids.idx_grids_workflow_runs_waiting`.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_runs_waiting_deadline
    ON grids.workflow_runs(waiting_deadline, id)
    WHERE status = 'waiting' AND waiting_deadline IS NOT NULL
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
      /*
       * What the step's effect did, on the row that already describes the step.
       *
       * This replaces a second table keyed by its own idempotency key, whose
       * only remaining job was to answer "did the write happen before we
       * crashed". A step already has one row per run; the answer belongs on it,
       * and the columns match workflows.step_outcome so the journal moves with
       * the runs rather than being translated.
       */
      effect_key TEXT CHECK (effect_key IS NULL OR char_length(effect_key) BETWEEN 1 AND 500),
      effect_state TEXT CHECK (effect_state IS NULL OR effect_state IN ('executing', 'succeeded', 'ambiguous', 'failed')),
      effect_started_at TIMESTAMPTZ,
      -- Recorded in the same transaction that performed the effect: a
      -- transactional action can only promise that a crash means it did not
      -- happen if the evidence commits with the work.
      effect_output JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      UNIQUE (run_id, step_key),
      CONSTRAINT workflow_step_runs_effect_chk CHECK ((effect_key IS NULL) = (effect_state IS NULL))
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_step_runs_run
    ON grids.workflow_step_runs(run_id, started_at, id)
  `.simple();
  // Effects that never settled are the queue a human works through.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_grids_workflow_step_runs_unsettled_effect
    ON grids.workflow_step_runs(effect_started_at, run_id)
    WHERE effect_state IN ('executing', 'ambiguous')
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
      workflow_id UUID,
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
  await migrateKernelProfile(sql);
  await migrateDefinitionLinks(sql);
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
