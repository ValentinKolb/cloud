import { sql } from "bun";

export const migrateCloudAi = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS ai`.simple();
  console.log("  ✓ ai schema");

  await sql`
    CREATE TABLE IF NOT EXISTS ai.conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL DEFAULT 'direct',
      resource_app_id TEXT,
      resource_type TEXT,
      resource_id TEXT,
      title TEXT NOT NULL DEFAULT 'New chat',
      icon TEXT NOT NULL DEFAULT 'ti ti-message',
      description TEXT NOT NULL DEFAULT '',
      created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      CONSTRAINT ai_conversations_resource_kind_check CHECK (resource_kind IN ('direct', 'resource'))
    )
  `.simple();

  await sql`ALTER TABLE ai.conversations ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT 'ti ti-message'`.simple();
  await sql`ALTER TABLE ai.conversations ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`.simple();
  // Enrichment (description/keywords/title upkeep) — dirty = updated_at > enriched_at.
  await sql`ALTER TABLE ai.conversations ADD COLUMN IF NOT EXISTS keywords TEXT[] NOT NULL DEFAULT '{}'`.simple();
  await sql`ALTER TABLE ai.conversations ADD COLUMN IF NOT EXISTS title_source TEXT NOT NULL DEFAULT 'default'`.simple();
  await sql`ALTER TABLE ai.conversations ADD COLUMN IF NOT EXISTS description_source TEXT NOT NULL DEFAULT 'default'`.simple();
  await sql`ALTER TABLE ai.conversations ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE ai.conversations ADD COLUMN IF NOT EXISTS enrich_failed_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE ai.conversations ADD COLUMN IF NOT EXISTS enrich_fail_count INTEGER NOT NULL DEFAULT 0`.simple();

  // Semantics fix: 'auto' is reserved for enrichment-set titles (which always set
  // enriched_at in the same update). First-message snapshot titles are 'default'
  // so enrichment may replace them freely. No-op once the code writes it that way.
  await sql`UPDATE ai.conversations SET title_source = 'default' WHERE title_source = 'auto' AND enriched_at IS NULL`.simple();

  // The AI summary moved into the user-visible description (guarded by
  // description_source, same pattern as title_source). Migrate stored
  // summaries into empty descriptions, then drop the column.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'ai' AND table_name = 'conversations' AND column_name = 'summary'
      ) THEN
        UPDATE ai.conversations
        SET description = LEFT(summary, 500), description_source = 'auto'
        WHERE description = '' AND summary <> '';
        ALTER TABLE ai.conversations DROP COLUMN summary;
      END IF;
    END $$
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_enrich_dirty
    ON ai.conversations(updated_at ASC)
    WHERE archived_at IS NULL
  `.simple();

  // Per-conversation enrichment history — user-visible in the chat settings.
  await sql`
    CREATE TABLE IF NOT EXISTS ai.enrichment_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'scheduled',
      model_profile_id TEXT,
      mode TEXT,
      duration_ms INTEGER,
      title_updated BOOLEAN NOT NULL DEFAULT FALSE,
      keywords_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ai_enrichment_runs_status_check CHECK (status IN ('ok', 'failed', 'skipped')),
      CONSTRAINT ai_enrichment_runs_trigger_check CHECK (trigger IN ('scheduled', 'manual'))
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_enrichment_runs_conversation_created
    ON ai.enrichment_runs(conversation_id, created_at DESC)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_app_owner_updated
    ON ai.conversations(app_id, created_by_user_id, updated_at DESC)
    WHERE archived_at IS NULL
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'message',
      role TEXT NOT NULL,
      message JSONB NOT NULL,
      model_profile_id TEXT,
      provider_model TEXT,
      usage JSONB,
      stop_reason TEXT,
      loop_id TEXT,
      loop_aggregate JSONB,
      loop_done_reason TEXT,
      compacted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ai_messages_kind_check CHECK (kind IN ('message', 'summary')),
      CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant', 'tool_result'))
    )
  `.simple();

  await sql`ALTER TABLE ai.messages ADD COLUMN IF NOT EXISTS compacted_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE ai.messages ADD COLUMN IF NOT EXISTS loop_id TEXT`.simple();
  await sql`ALTER TABLE ai.messages ADD COLUMN IF NOT EXISTS loop_aggregate JSONB`.simple();
  await sql`ALTER TABLE ai.messages ADD COLUMN IF NOT EXISTS loop_done_reason TEXT`.simple();
  await sql`ALTER TABLE ai.messages ADD COLUMN IF NOT EXISTS meta JSONB`.simple();

  // Seq is only unique among active (non-compacted) rows: compaction archives rows
  // in place and the summary takes over the checkpoint seq.
  await sql`ALTER TABLE ai.messages DROP CONSTRAINT IF EXISTS ai_messages_seq_unique`.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_active_seq_unique
    ON ai.messages(conversation_id, seq)
    WHERE compacted_at IS NULL
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_seq
    ON ai.messages(conversation_id, seq ASC)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_messages_active_conversation_seq
    ON ai.messages(conversation_id, seq ASC)
    WHERE compacted_at IS NULL
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_messages_active_conversation_loop_seq
    ON ai.messages(conversation_id, loop_id, seq ASC)
    WHERE compacted_at IS NULL AND loop_id IS NOT NULL
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.turns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      model_profile_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      live_blocks JSONB,
      live_seq BIGINT NOT NULL DEFAULT 0,
      deadline TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      error TEXT,
      cancel_requested_at TIMESTAMPTZ,
      cancellation_reason TEXT,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      run_config JSONB,
      CONSTRAINT ai_turns_status_check CHECK (status IN ('queued', 'running', 'waiting_for_action', 'completed', 'failed', 'aborted'))
    )
  `.simple();

  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS lease_owner TEXT`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS run_config JSONB`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS live_blocks JSONB`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS live_seq BIGINT NOT NULL DEFAULT 0`.simple();
  await sql`ALTER TABLE ai.turns ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE ai.turns ALTER COLUMN status SET DEFAULT 'queued'`.simple();
  await sql`
    UPDATE ai.turns
    SET run_config = (run_config #>> '{}')::jsonb
    WHERE jsonb_typeof(run_config) = 'string'
  `.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_turns_one_active_per_conversation
    ON ai.turns(conversation_id)
    WHERE status IN ('queued', 'running', 'waiting_for_action')
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_turns_conversation_created
    ON ai.turns(conversation_id, created_at DESC)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_turns_completed_chat
    ON ai.turns(completed_at, id)
    WHERE status = 'completed' AND run_config->>'kind' = 'chat'
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.turn_steers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
      turn_id UUID NOT NULL REFERENCES ai.turns(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      client_request_id TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      message_id UUID REFERENCES ai.messages(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      consumed_at TIMESTAMPTZ,
      CONSTRAINT ai_turn_steers_status_check CHECK (status IN ('pending', 'consumed', 'discarded')),
      CONSTRAINT ai_turn_steers_text_check CHECK (length(btrim(text)) BETWEEN 1 AND 20000)
    )
  `.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_turn_steers_turn_seq
    ON ai.turn_steers(turn_id, seq)
  `.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_turn_steers_request
    ON ai.turn_steers(turn_id, client_request_id)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_turn_steers_pending
    ON ai.turn_steers(conversation_id, turn_id, seq ASC)
    WHERE status = 'pending'
  `.simple();

  // Streaming persistence moved to live_blocks snapshots plus the Redis fanout
  // topic; the per-delta event log is gone.
  await sql`DROP TABLE IF EXISTS ai.turn_events`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.pending_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      turn_id UUID NOT NULL REFERENCES ai.turns(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      args JSONB NOT NULL,
      message TEXT,
      approval_scope TEXT NOT NULL,
      allow_always BOOLEAN NOT NULL DEFAULT FALSE,
      frontend_mode TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_event JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ,
      CONSTRAINT ai_pending_actions_kind_check CHECK (kind IN ('approval', 'custom_approval', 'client_tool')),
      CONSTRAINT ai_pending_actions_status_check CHECK (status IN ('pending', 'resolved', 'aborted'))
    )
  `.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_pending_actions_turn_call
    ON ai.pending_actions(turn_id, call_id)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_pending_turn
    ON ai.pending_actions(conversation_id, turn_id, created_at ASC)
    WHERE status = 'pending'
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.tool_approval_preferences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL,
      resource_app_id TEXT,
      resource_type TEXT,
      resource_id TEXT,
      tool_name TEXT NOT NULL,
      approval_scope TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      CONSTRAINT ai_tool_approval_preferences_unique UNIQUE (
        actor_user_id,
        app_id,
        resource_app_id,
        resource_type,
        resource_id,
        tool_name,
        approval_scope
      )
    )
  `.simple();

  await sql`ALTER TABLE ai.tool_approval_preferences ADD COLUMN IF NOT EXISTS resource_app_id TEXT`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.tool_calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      turn_id UUID NOT NULL REFERENCES ai.turns(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT 'server',
      status TEXT NOT NULL DEFAULT 'pending',
      approval_state TEXT NOT NULL DEFAULT 'not_required',
      input_meta JSONB,
      output_meta JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      approval_requested_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      CONSTRAINT ai_tool_calls_status_check CHECK (status IN ('pending', 'running', 'waiting_for_approval', 'waiting_for_frontend', 'completed', 'failed', 'rejected')),
      CONSTRAINT ai_tool_calls_approval_state_check CHECK (approval_state IN ('not_required', 'waiting', 'approved_once', 'approved_always', 'approved_by_preference', 'rejected'))
    )
  `.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_tool_calls_turn_call
    ON ai.tool_calls(turn_id, call_id)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_conversation_created
    ON ai.tool_calls(conversation_id, created_at DESC)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.user_prefs (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      instructions TEXT NOT NULL DEFAULT '',
      memory TEXT NOT NULL DEFAULT '',
      memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();

  // Last model the user actually ran a turn with — preselected for new chats.
  await sql`ALTER TABLE ai.user_prefs ADD COLUMN IF NOT EXISTS last_model_id TEXT NOT NULL DEFAULT ''`.simple();

  // ── Conversation virtual filesystem (bash tool workspace) ──────────────
  await sql`
    CREATE TABLE IF NOT EXISTS ai.files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ai_files_path_unique UNIQUE (conversation_id, path)
    )
  `.simple();
  // EXTERNAL keeps bytea un-compressed in TOAST so substring() slices read
  // only the needed chunks — head/tail on big files must not load everything.
  await sql`ALTER TABLE ai.files ALTER COLUMN bytes SET STORAGE EXTERNAL`.simple();

  // ── Skill registry (full agent-skills standard: one skill = a file tree) ─
  // No description column: the description lives in SKILL.md frontmatter —
  // single source of truth, parsed on read.
  await sql`
    CREATE TABLE IF NOT EXISTS ai.skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT NOT NULL UNIQUE,
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      allow_code BOOLEAN NOT NULL DEFAULT FALSE,
      code_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      code_approved_at TIMESTAMPTZ,
      code_approved_hash TEXT,
      code_review_requested_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ai_skills_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$')
    )
  `.simple();
  await sql`ALTER TABLE ai.skills DROP COLUMN IF EXISTS description`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.skill_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      skill_id UUID NOT NULL REFERENCES ai.skills(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'text/markdown',
      size INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ai_skill_files_path_unique UNIQUE (skill_id, path)
    )
  `.simple();
  await sql`ALTER TABLE ai.skill_files ALTER COLUMN bytes SET STORAGE EXTERNAL`.simple();

  // Per-user activation. Foreign shares default to disabled (consent) —
  // enforced in code via the default-state rules, not in the schema.
  await sql`
    CREATE TABLE IF NOT EXISTS ai.skill_user_state (
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      skill_id UUID NOT NULL REFERENCES ai.skills(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, skill_id),
      CONSTRAINT ai_skill_user_state_check CHECK (state IN ('enabled', 'disabled'))
    )
  `.simple();

  // Junction to the generic auth.access entries (standard permission system).
  await sql`
    CREATE TABLE IF NOT EXISTS ai.skill_access (
      skill_id UUID NOT NULL REFERENCES ai.skills(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (skill_id, access_id)
    )
  `.simple();

  // Durable audit log — security decisions must not depend on trace retention.
  // skill_id has no FK so history survives skill deletion; slug is denormalized.
  await sql`
    CREATE TABLE IF NOT EXISTS ai.skill_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      skill_id UUID NOT NULL,
      skill_slug TEXT NOT NULL,
      actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      event TEXT NOT NULL,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ai_skill_events_event_check CHECK (event IN (
        'created', 'updated', 'deleted', 'enabled', 'disabled',
        'shared', 'unshared', 'code_review_requested', 'code_approved', 'code_revoked'
      ))
    )
  `.simple();

  // Keyset pagination orders on (created_at, id); the per-skill history
  // filters by skill_id first. The old single-column index is superseded.
  await sql`DROP INDEX IF EXISTS ai.idx_ai_skill_events_created`.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_skill_events_created_id
    ON ai.skill_events(created_at DESC, id DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_skill_events_skill_created
    ON ai.skill_events(skill_id, created_at DESC, id DESC)
  `.simple();

  // Builtin skills ship as prepopulated workspace skills — seeded once, then
  // owned by admins like any other workspace skill (deletions stick).
  // Dynamic import keeps the migration module free of store dependencies.
  const { seedBuiltinAiSkills } = await import("./builtin-skills");
  await seedBuiltinAiSkills();

  console.log("  ✓ ai conversation tables");
};
