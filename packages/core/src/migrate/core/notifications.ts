import { sql } from "bun";

// ==========================
// Schema: notifications
// ==========================

/**
 * Creates the notifications schema and tables.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ notifications.messages table");

  // Add sent_by column to track who sent the notification
  await sql`ALTER TABLE notifications.messages ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL`.simple();
  console.log("  ✓ notifications.messages.sent_by column");
};
