import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS terms`.simple();
  console.log("  ✓ terms schema");

  await sql`
    CREATE TABLE IF NOT EXISTS terms.versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ terms.versions table");
};
