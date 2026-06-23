import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS notifications`.simple();
  console.log("  ✓ notifications schema");

  await sql`
    CREATE TABLE IF NOT EXISTS notifications.messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL DEFAULT 'email',
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      sent_at TIMESTAMPTZ,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
    )
  `.simple();
  console.log("  ✓ notifications.messages table");

  await sql`
    CREATE TABLE IF NOT EXISTS notifications.batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subject TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      body_html TEXT NOT NULL,
      selection JSONB NOT NULL DEFAULT '{}'::jsonb,
      selection_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      finalized_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finalized_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      target_count INTEGER NOT NULL DEFAULT 0,
      deliverable_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      CONSTRAINT notification_batches_status_check CHECK (
        status IN ('draft', 'ready', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled')
      )
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_notification_batches_status_created
    ON notifications.batches(status, created_at DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_notification_batches_created_by
    ON notifications.batches(created_by, created_at DESC)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS notifications.batch_recipients (
      batch_id UUID NOT NULL REFERENCES notifications.batches(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      recipient TEXT,
      uid TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL,
      profile TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notification_id UUID REFERENCES notifications.messages(id) ON DELETE SET NULL,
      error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      sent_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (batch_id, user_id),
      CONSTRAINT notification_batch_recipients_status_check CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'error'))
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_notification_batch_recipients_status
    ON notifications.batch_recipients(batch_id, status)
  `.simple();
  console.log("  ✓ notifications batch tables");
};
