import { sql } from "bun";

/**
 * Creates the weather locations table.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export const migrate = async (): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS weather_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      state TEXT,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ weather_locations table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_weather_locations_user
    ON weather_locations(user_id)
  `.simple();
  console.log("  ✓ weather_locations index");
};
