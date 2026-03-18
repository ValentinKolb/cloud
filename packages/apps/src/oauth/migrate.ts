import { sql } from "bun";

/**
 * Creates the oauth schema and all related tables.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS oauth`.simple();
  console.log("  ✓ oauth schema");

  await sql`
    CREATE TABLE IF NOT EXISTS oauth.clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      client_id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
      client_secret_hash TEXT,
      redirect_uris TEXT[] NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT ARRAY['openid', 'profile', 'email'],
      allowed_profiles TEXT[] NOT NULL DEFAULT ARRAY['user', 'guest'],
      is_public BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by UUID REFERENCES auth.users(id)
    )
  `.simple();

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'oauth_clients_name_key'
      ) THEN
        ALTER TABLE oauth.clients ADD CONSTRAINT oauth_clients_name_key UNIQUE (name);
      END IF;
    END $$
  `.simple();

  await sql`
    ALTER TABLE oauth.clients ADD COLUMN IF NOT EXISTS description TEXT
  `.simple();

  await sql`
    ALTER TABLE oauth.clients ADD COLUMN IF NOT EXISTS logout_uri TEXT
  `.simple();

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'oauth' AND table_name = 'clients' AND column_name = 'allowed_realms'
      ) THEN
        ALTER TABLE oauth.clients RENAME COLUMN allowed_realms TO allowed_profiles;
      END IF;
    END $$
  `.simple();

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'oauth' AND table_name = 'clients' AND column_name = 'allowed_roles'
      ) THEN
        ALTER TABLE oauth.clients RENAME COLUMN allowed_roles TO allowed_profiles;
      END IF;
    END $$
  `.simple();

  await sql`
    ALTER TABLE oauth.clients ADD COLUMN IF NOT EXISTS allowed_profiles TEXT[] NOT NULL DEFAULT ARRAY['user', 'guest']
  `.simple();

  await sql`
    UPDATE oauth.clients
    SET allowed_profiles = COALESCE(
      ARRAY(
        SELECT DISTINCT mapped
        FROM (
          SELECT CASE
            WHEN value = 'ipa' THEN 'user'
            WHEN value IN ('ipa-limited', 'guest') THEN 'guest'
            WHEN value IN ('user', 'guest') THEN value
            ELSE NULL
          END AS mapped
          FROM unnest(allowed_profiles) AS value
        ) mapped_values
        WHERE mapped IS NOT NULL
      ),
      ARRAY['user', 'guest']::text[]
    )
  `.simple();

  console.log("  ✓ oauth.clients table");

  await sql`
    CREATE TABLE IF NOT EXISTS oauth.codes (
      code TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      client_id TEXT NOT NULL REFERENCES oauth.clients(client_id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT,
      code_challenge_method TEXT CHECK (code_challenge_method IN ('S256', 'plain')),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '5 minutes',
      used BOOLEAN NOT NULL DEFAULT false
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires
    ON oauth.codes(expires_at)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_codes_client
    ON oauth.codes(client_id)
  `.simple();
  console.log("  ✓ oauth.codes table");

  await sql`
    CREATE TABLE IF NOT EXISTS oauth.keys (
      id TEXT PRIMARY KEY DEFAULT 'current',
      private_key TEXT NOT NULL,
      public_key TEXT NOT NULL,
      kid TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ oauth.keys table");
};
