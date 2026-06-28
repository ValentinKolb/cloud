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
      created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      CONSTRAINT ai_conversations_resource_kind_check CHECK (resource_kind IN ('direct', 'resource'))
    )
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT ai_messages_kind_check CHECK (kind IN ('message', 'summary')),
      CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant', 'tool_result')),
      CONSTRAINT ai_messages_seq_unique UNIQUE (conversation_id, seq)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_seq
    ON ai.messages(conversation_id, seq ASC)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS ai.turns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      model_profile_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      error TEXT,
      CONSTRAINT ai_turns_status_check CHECK (status IN ('running', 'completed', 'failed', 'aborted'))
    )
  `.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_turns_one_running_per_conversation
    ON ai.turns(conversation_id)
    WHERE status = 'running'
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_turns_conversation_created
    ON ai.turns(conversation_id, created_at DESC)
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
    UPDATE ai.tool_approval_preferences
    SET resource_app_id = app_id
    WHERE resource_app_id IS NULL
      AND resource_type IS NOT NULL
  `.simple();
  await sql`ALTER TABLE ai.tool_approval_preferences DROP CONSTRAINT IF EXISTS ai_tool_approval_preferences_unique`.simple();
  await sql`
    ALTER TABLE ai.tool_approval_preferences
    ADD CONSTRAINT ai_tool_approval_preferences_unique UNIQUE (
      actor_user_id,
      app_id,
      resource_app_id,
      resource_type,
      resource_id,
      tool_name,
      approval_scope
    )
  `.simple();

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
