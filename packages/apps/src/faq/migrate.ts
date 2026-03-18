import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS faq`.simple();
  console.log("  ✓ faq schema");

  await sql`
    CREATE TABLE IF NOT EXISTS faq.entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      audience TEXT[] NOT NULL,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();

  await sql`
    UPDATE faq.entries
    SET audience = COALESCE(
      ARRAY(
        SELECT DISTINCT mapped
        FROM (
          SELECT CASE
            WHEN value = 'ipa' THEN 'user'
            WHEN value IN ('ipa-limited', 'guest') THEN 'guest'
            WHEN value IN ('user', 'guest', 'anonymous') THEN value
            ELSE NULL
          END AS mapped
          FROM unnest(audience) AS value
        ) mapped_values
        WHERE mapped IS NOT NULL
      ),
      ARRAY['anonymous']::text[]
    )
  `.simple();

  console.log("  ✓ faq.entries table");
};
