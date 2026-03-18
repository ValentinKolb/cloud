import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS settings`.simple();
  console.log("  ✓ settings schema");

  await sql`
    CREATE TABLE IF NOT EXISTS settings.entries (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ settings.entries table");

  const [valueColumn] = await sql<{ data_type: string | null }[]>`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'settings'
      AND table_name = 'entries'
      AND column_name = 'value'
  `;

  if (valueColumn?.data_type === "jsonb") {
    await sql`
      ALTER TABLE settings.entries
      ALTER COLUMN value TYPE TEXT
      USING value::text
    `.simple();
    console.log("  ✓ settings.entries.value migrated to text");
  }
};
