import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS oauth`.simple();
  console.log("  ✓ oauth schema");

  await sql`
    CREATE TABLE IF NOT EXISTS oauth.clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      client_id TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
      client_secret_hash TEXT,
      redirect_uris TEXT[] NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT ARRAY['openid', 'profile', 'email'],
      audiences TEXT[] NOT NULL DEFAULT ARRAY['cloud'],
      service_account_id UUID REFERENCES auth.service_accounts(id) ON DELETE SET NULL,
      allowed_profiles TEXT[] NOT NULL DEFAULT ARRAY['user', 'guest'],
      is_public BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by UUID REFERENCES auth.users(id),
      logout_uri TEXT,
      CONSTRAINT clients_name_key UNIQUE (name)
    )
  `.simple();
  await sql`
    ALTER TABLE oauth.clients
    ADD COLUMN IF NOT EXISTS audiences TEXT[] NOT NULL DEFAULT ARRAY['cloud']
  `.simple();
  await sql`
    ALTER TABLE oauth.clients
    ADD COLUMN IF NOT EXISTS service_account_id UUID REFERENCES auth.service_accounts(id) ON DELETE SET NULL
  `.simple();
  await sql`
    ALTER TABLE oauth.clients
    ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'profiles'
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oauth_clients_access_mode_check'
          AND conrelid = 'oauth.clients'::regclass
      ) THEN
        ALTER TABLE oauth.clients
        ADD CONSTRAINT oauth_clients_access_mode_check CHECK (access_mode IN ('profiles', 'specific'));
      END IF;
    END $$
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_clients_service_account
    ON oauth.clients(service_account_id)
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'oauth_clients_name_key'
      ) THEN
        ALTER TABLE oauth.clients
        ADD CONSTRAINT oauth_clients_name_key UNIQUE (name);
      END IF;
    END $$;
  `.simple();
  console.log("  ✓ oauth.clients table");

  await sql`
    CREATE TABLE IF NOT EXISTS oauth.client_access_users (
      client_id UUID NOT NULL REFERENCES oauth.clients(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      PRIMARY KEY (client_id, user_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_client_access_users_user
    ON oauth.client_access_users(user_id)
  `.simple();
  await sql`
    CREATE TABLE IF NOT EXISTS oauth.client_access_groups (
      client_id UUID NOT NULL REFERENCES oauth.clients(id) ON DELETE CASCADE,
      group_id UUID NOT NULL REFERENCES auth.groups(id) ON DELETE CASCADE,
      PRIMARY KEY (client_id, group_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_client_access_groups_group
    ON oauth.client_access_groups(group_id)
  `.simple();
  console.log("  ✓ oauth client access tables");

  await sql`
    CREATE TABLE IF NOT EXISTS oauth.codes (
      code TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      client_id TEXT NOT NULL REFERENCES oauth.clients(client_id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      redirect_uri TEXT NOT NULL,
      nonce TEXT,
      code_challenge TEXT,
      code_challenge_method TEXT CHECK (code_challenge_method IN ('S256', 'plain')),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '5 minutes',
      used BOOLEAN NOT NULL DEFAULT false
    )
  `.simple();
  await sql`
    ALTER TABLE oauth.codes
    ADD COLUMN IF NOT EXISTS nonce TEXT
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
