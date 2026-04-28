import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS logging`.simple();
  console.log("  ✓ logging schema");

  await sql`
    CREATE TABLE IF NOT EXISTS logging.entries (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      level TEXT NOT NULL DEFAULT 'info',
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ logging.entries table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_logging_entries_source
    ON logging.entries(source)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_logging_entries_level
    ON logging.entries(level)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_logging_entries_created_at
    ON logging.entries(created_at DESC)
  `.simple();
  // Composite index for the dashboard summary query: filters of the shape
  // `WHERE level = 'error' AND created_at > <cutoff> ORDER BY created_at DESC`
  // become index-only scans. Massively cheaper than the single-column indexes
  // when the table grows past tens of thousands of rows.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_logging_entries_level_created_at
    ON logging.entries(level, created_at DESC)
  `.simple();
  console.log("  ✓ logging indexes");
};
