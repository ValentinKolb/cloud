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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_turns_one_active_per_conversation
    ON ai.turns(conversation_id)
    WHERE status IN ('queued', 'running', 'waiting_for_action')
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_turns_conversation_created
    ON ai.turns(conversation_id, created_at DESC)
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

  console.log("  ✓ ai conversation tables");
};
