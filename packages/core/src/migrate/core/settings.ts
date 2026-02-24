import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS settings`.simple();
  console.log("  ✓ settings schema");

  await sql`
    CREATE TABLE IF NOT EXISTS settings.entries (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ settings.entries table");
};
