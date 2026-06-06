import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS dashboard`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS dashboard.user_settings (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      gradient TEXT NOT NULL DEFAULT 'default',
      hidden_widgets TEXT[] NOT NULL DEFAULT '{}'::text[],
      shortcuts JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
};
