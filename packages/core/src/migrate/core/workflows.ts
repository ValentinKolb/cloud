/**
 * The workflow kernel's own storage.
 *
 * Grids and Mail each grew a full run engine — two run tables, two step
 * journals, two lease protocols, two state vocabularies that disagree about
 * what `waiting` means. Both are alpha, so there is one schema here and no
 * compatibility shim.
 *
 * The three rules the shape encodes:
 *   1. A plan is immutable; a run pins its version.
 *   2. A step is a function of its inputs and the prior outcomes.
 *   3. Outcomes are journaled; a recorded outcome is never recomputed.
 *
 * Execution is therefore "find the first step with no recorded outcome, run
 * it, record it". Crash recovery is that same loop, not a second code path.
 *
 * The kernel is app-agnostic: `app_id` and `scope_id` are opaque strings, not
 * foreign keys, because `workflows` cannot reference `grids.bases` or
 * `mail.mailboxes` without inverting the dependency. Apps drop their own
 * workflows when a scope goes away.
 */
import { sql } from "bun";

/**
 * The state vocabularies below are inlined as literal SQL rather than shared
 * constants because `.simple()` admits no bind parameters. They are a
 * projection of the kernel's own `WorkflowRunState`, `WorkflowStepOutcome` and
 * `WorkflowPlanningOutcome` discriminants — a state only one app can enter is
 * a state the other app's UI renders wrong, so nothing is invented here.
 */
export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS workflows`.simple();
  console.log("  ✓ workflows schema");

  // ─── Definition ────────────────────────────────────────────────────────────

  await sql`
    CREATE TABLE IF NOT EXISTS workflows.workflow (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
      active_version_id UUID,
      created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('user', 'service_account', 'system')),
      created_by_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT workflow_created_by_chk CHECK (
        (created_by_kind = 'system' AND created_by_id IS NULL) OR (created_by_kind <> 'system' AND created_by_id IS NOT NULL)
      ),
      UNIQUE (app_id, scope_id, key),
      UNIQUE (id, app_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_workflow_scope
    ON workflows.workflow(app_id, scope_id, name, id)
  `.simple();
  console.log("  ✓ workflows.workflow table");

  /**
   * A version is written once and never updated. Grids relied on convention
   * for this and Mail on a trigger; the trigger is the one that actually
   * holds, because a run pinned to a version has no way to notice that the
   * plan underneath it changed.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS workflows.version (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID NOT NULL REFERENCES workflows.workflow(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 200000),
      source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
      plan JSONB NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
      diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(diagnostics) = 'array'),
      -- Caps on external effects, keyed by dimension. Grids had none: an email
      -- action inside a loop over ten thousand records was bounded only by the
      -- loop limit, which is a safety gap rather than a missing convenience.
      effect_budget JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(effect_budget) = 'object'),
      language_id TEXT NOT NULL CHECK (char_length(language_id) BETWEEN 1 AND 200),
      language_version INTEGER NOT NULL CHECK (language_version > 0),
      manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
      created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('user', 'service_account', 'system')),
      created_by_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workflow_id, revision),
      UNIQUE (id, workflow_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_version_history
    ON workflows.version(workflow_id, revision DESC)
  `.simple();

  await sql`
    CREATE OR REPLACE FUNCTION workflows.reject_version_update() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'workflow versions are immutable' USING ERRCODE = '55000';
    END;
    $$ LANGUAGE plpgsql
  `.simple();
  await sql`DROP TRIGGER IF EXISTS version_reject_update ON workflows.version`.simple();
  await sql`
    CREATE TRIGGER version_reject_update
    BEFORE UPDATE ON workflows.version
    FOR EACH ROW EXECUTE FUNCTION workflows.reject_version_update()
  `.simple();

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_active_version_fk') THEN
        ALTER TABLE workflows.workflow
          ADD CONSTRAINT workflow_active_version_fk
          FOREIGN KEY (active_version_id, id) REFERENCES workflows.version(id, workflow_id) ON DELETE SET NULL (active_version_id)
          DEFERRABLE INITIALLY DEFERRED;
      END IF;
    END $$
  `.simple();
  console.log("  ✓ workflows.version table");

  /**
   * Binds one version to one event type. Activations are what the dispatcher
   * reads, so pinning the version here — rather than following the workflow's
   * current pointer — is what stops an edit from redirecting work that is
   * already in flight.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS workflows.activation (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID NOT NULL,
      workflow_version_id UUID NOT NULL,
      key TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
      event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 200),
      config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
      authorization_snapshot JSONB NOT NULL CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_version_id, workflow_id) REFERENCES workflows.version(id, workflow_id) ON DELETE CASCADE,
      UNIQUE (workflow_id, key)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_activation_dispatch
    ON workflows.activation(event_type, workflow_id, id)
    WHERE enabled
  `.simple();
  console.log("  ✓ workflows.activation table");

  // ─── Cause ─────────────────────────────────────────────────────────────────

  /**
   * Everything that starts work is an event: a schedule tick, a button press,
   * an inbound message. A run therefore always has an inspectable cause rather
   * than a bare channel enum, and one event can start several runs.
   *
   * `dedupe_key` makes delivery at-most-once for the sources that can repeat
   * themselves — a schedule slot, a provider webhook.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS workflows.event (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (char_length(type) BETWEEN 1 AND 200),
      data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
      dedupe_key TEXT CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 500),
      occurred_at TIMESTAMPTZ NOT NULL,
      dispatched_at TIMESTAMPTZ,
      -- Dispatch can fail on its own — a version deleted mid-flight, a
      -- constraint the activation violates. Recording why keeps an event that
      -- matched nothing from disappearing silently, which is how Grids'
      -- schedules stopped firing with no error anywhere.
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_event_dedupe
    ON workflows.event(app_id, type, dedupe_key)
    WHERE dedupe_key IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_event_pending
    ON workflows.event(occurred_at, id)
    WHERE dispatched_at IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_event_history
    ON workflows.event(app_id, scope_id, occurred_at DESC, id DESC)
  `.simple();
  console.log("  ✓ workflows.event table");

  // ─── Execution ─────────────────────────────────────────────────────────────

  /**
   * Fan-out is child runs via `parent_run_id`, not a targets table. A 10,000
   * row bulk operation becomes 10,000 runs — the same row count Mail's
   * `workflow_run_targets` would have produced, but with one lease protocol,
   * one journal and one observability query instead of two of each.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS workflows.run (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      workflow_id UUID NOT NULL,
      workflow_version_id UUID NOT NULL,
      event_id UUID REFERENCES workflows.event(id) ON DELETE SET NULL,
      parent_run_id UUID REFERENCES workflows.run(id) ON DELETE CASCADE,
      parent_step_key TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('execute', 'dryRun')),
      state TEXT NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'needs_attention')),
      inputs JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inputs) = 'object'),
      -- What this run has actually spent, charged as it goes. Checking only
      -- before execution is what let Mail approve one set of effects and
      -- perform another; charging at the moment of the effect closes that.
      effects_used JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(effects_used) = 'object'),
      authorization_snapshot JSONB NOT NULL CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
      occurred_at TIMESTAMPTZ NOT NULL,
      -- The fence. Every claim increments it, so a worker whose lease expired
      -- writes with a stale generation and is rejected. A lease token would be
      -- a second fence that can never disagree with this one.
      execution_generation BIGINT NOT NULL DEFAULT 0 CHECK (execution_generation >= 0),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      -- Set when a worker gives up a lease without recording an outcome, so a
      -- run that keeps dying cannot spin at full speed.
      retry_after TIMESTAMPTZ,
      -- When this run may next be picked up, as one orderable value: a queued
      -- run has never been leased, an expired lease is claimable again, and a
      -- released one waits out its backoff. Asking that as a disjunction over
      -- two nullable columns cannot be answered by one index scan, and
      -- degrades to a full scan of every unfinished run — measured, not
      -- assumed.
      claimable_at TIMESTAMPTZ NOT NULL GENERATED ALWAYS AS (
        GREATEST(COALESCE(lease_expires_at, '-infinity'::timestamptz), COALESCE(retry_after, '-infinity'::timestamptz))
      ) STORED,
      wake_at TIMESTAMPTZ,
      cancel_requested_at TIMESTAMPTZ,
      result JSONB,
      error JSONB CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_version_id, workflow_id) REFERENCES workflows.version(id, workflow_id) ON DELETE RESTRICT,
      CONSTRAINT run_parent_chk CHECK ((parent_run_id IS NULL) = (parent_step_key IS NULL)),
      CONSTRAINT run_lease_chk CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
      UNIQUE (workflow_id, mode, idempotency_key)
    )
  `.simple();
  // Claimable work, oldest first:
  //   WHERE state IN ('queued', 'running') AND claimable_at < now()
  //   ORDER BY claimable_at, created_at, id
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_run_dispatch
    ON workflows.run(claimable_at, created_at, id)
    WHERE state IN ('queued', 'running')
  `.simple();
  // Parked runs the wake scan has to pick up once their deadline passes.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_run_wake
    ON workflows.run(wake_at, id)
    WHERE state = 'waiting' AND wake_at IS NOT NULL
  `.simple();
  // Fan-out: both "how are my children doing" and "list them" read this.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_run_children
    ON workflows.run(parent_run_id, state, created_at, id)
    WHERE parent_run_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_run_workflow_history
    ON workflows.run(workflow_id, created_at DESC, id DESC)
    WHERE parent_run_id IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_run_scope_history
    ON workflows.run(app_id, scope_id, created_at DESC, id DESC)
    WHERE parent_run_id IS NULL
  `.simple();
  console.log("  ✓ workflows.run table");

  /**
   * The journal. A recorded outcome is never recomputed, so this table is what
   * makes a replay after a crash skip the work that already happened.
   *
   * Effects live here too rather than in a separate intent table: an impure
   * step writes `effect_state = 'executing'` with its key before it acts, then
   * settles it. The key is stable across replays — it is derived from the run
   * and step — so `(run_id, step_key)` already guarantees the uniqueness Grids
   * enforced with a global unique index on its intents.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS workflows.step_outcome (
      run_id UUID NOT NULL REFERENCES workflows.run(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL CHECK (char_length(step_key) BETWEEN 1 AND 1000),
      source_path JSONB NOT NULL CHECK (jsonb_typeof(source_path) = 'array'),
      iteration_path JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(iteration_path) = 'array'),
      kind TEXT NOT NULL,
      action TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('execute', 'dryRun')),
      state TEXT NOT NULL CHECK (
        state IN (
          'running',
          -- WorkflowStepOutcome
          'completed', 'waiting', 'failed', 'needs_attention', 'terminal',
          -- WorkflowPlanningOutcome
          'planned', 'unsupported', 'indeterminate', 'canceled'
        )
      ),
      outcome JSONB,
      dependency JSONB CHECK (dependency IS NULL OR jsonb_typeof(dependency) = 'object'),
      execution_generation BIGINT NOT NULL CHECK (execution_generation >= 0),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
      effect_key TEXT CHECK (effect_key IS NULL OR char_length(effect_key) BETWEEN 1 AND 500),
      effect_state TEXT CHECK (effect_state IS NULL OR effect_state IN ('executing', 'succeeded', 'ambiguous', 'failed')),
      effect_started_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, step_key),
      CONSTRAINT step_outcome_effect_chk CHECK ((effect_key IS NULL) = (effect_state IS NULL)),
      -- A step has an outcome exactly when it is no longer in flight.
      CONSTRAINT step_outcome_settled_chk CHECK (
        (state IN ('running', 'waiting') AND outcome IS NULL)
        OR (state NOT IN ('running', 'waiting') AND outcome IS NOT NULL)
      ),
      CONSTRAINT step_outcome_dependency_chk CHECK ((state = 'waiting') = (dependency IS NOT NULL))
    )
  `.simple();
  // Resuming a parked run: find the steps blocked on a dependency that fired.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_step_outcome_dependency
    ON workflows.step_outcome((dependency ->> 'kind'), (dependency ->> 'key'))
    WHERE state = 'waiting'
  `.simple();
  // Ambiguous effects that never settled are the queue a human works through.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workflows_step_outcome_unsettled_effect
    ON workflows.step_outcome(effect_started_at, run_id)
    WHERE effect_state IN ('executing', 'ambiguous')
  `.simple();
  console.log("  ✓ workflows.step_outcome table");
};
