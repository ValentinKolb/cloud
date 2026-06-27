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
      scopes TEXT[] NOT NULL DEFAULT ARRAY['openid', 'profile', 'email'],
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
    ALTER TABLE oauth.codes
    ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY['openid', 'profile', 'email']
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
    CREATE TABLE IF NOT EXISTS oauth.refresh_token_families (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL REFERENCES oauth.clients(client_id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      scopes TEXT[] NOT NULL,
      audiences TEXT[] NOT NULL DEFAULT ARRAY['cloud'],
      label TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      revoked_reason TEXT,
      CONSTRAINT oauth_refresh_token_families_status_check CHECK (status IN ('active', 'revoked'))
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_refresh_token_families_user
    ON oauth.refresh_token_families(user_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_refresh_token_families_client
    ON oauth.refresh_token_families(client_id)
  `.simple();
  await sql`
    CREATE TABLE IF NOT EXISTS oauth.refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_id UUID NOT NULL REFERENCES oauth.refresh_token_families(id) ON DELETE CASCADE,
      token_prefix TEXT NOT NULL UNIQUE,
      secret_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      generation INTEGER NOT NULL,
      previous_token_id UUID REFERENCES oauth.refresh_tokens(id),
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      rotated_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      CONSTRAINT oauth_refresh_tokens_status_check CHECK (status IN ('active', 'rotated', 'revoked', 'reused'))
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family
    ON oauth.refresh_tokens(family_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires
    ON oauth.refresh_tokens(expires_at)
  `.simple();
  console.log("  ✓ oauth refresh token tables");

  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM oauth.clients WHERE client_id = 'cloud-cli') THEN
        UPDATE oauth.clients
        SET description = COALESCE(description, 'First-party public OAuth client for the cloud CLI.'),
          redirect_uris = ARRAY(
            SELECT DISTINCT value
            FROM unnest(redirect_uris || ARRAY['http://127.0.0.1/callback', 'http://[::1]/callback']) AS added(value)
          ),
          scopes = ARRAY(
            SELECT DISTINCT value
            FROM unnest(scopes || ARRAY['openid', 'profile', 'email', 'offline_access', 'read', 'write']) AS added(value)
          ),
          audiences = ARRAY(
            SELECT DISTINCT value
            FROM unnest(audiences || ARRAY['cloud']) AS added(value)
          ),
          is_public = true
        WHERE client_id = 'cloud-cli';
      ELSIF EXISTS (SELECT 1 FROM oauth.clients WHERE name = 'Cloud CLI') THEN
        UPDATE oauth.clients
        SET client_id = 'cloud-cli',
          description = COALESCE(description, 'First-party public OAuth client for the cloud CLI.'),
          redirect_uris = ARRAY(
            SELECT DISTINCT value
            FROM unnest(redirect_uris || ARRAY['http://127.0.0.1/callback', 'http://[::1]/callback']) AS added(value)
          ),
          scopes = ARRAY(
            SELECT DISTINCT value
            FROM unnest(scopes || ARRAY['openid', 'profile', 'email', 'offline_access', 'read', 'write']) AS added(value)
          ),
          audiences = ARRAY(
            SELECT DISTINCT value
            FROM unnest(audiences || ARRAY['cloud']) AS added(value)
          ),
          is_public = true
        WHERE name = 'Cloud CLI';
      ELSE
        INSERT INTO oauth.clients (
          name,
          description,
          client_id,
          redirect_uris,
          scopes,
          audiences,
          allowed_profiles,
          access_mode,
          is_public
        )
        VALUES (
          'Cloud CLI',
          'First-party public OAuth client for the cloud CLI.',
          'cloud-cli',
          ARRAY['http://127.0.0.1/callback', 'http://[::1]/callback'],
          ARRAY['openid', 'profile', 'email', 'offline_access', 'read', 'write'],
          ARRAY['cloud'],
          ARRAY['user', 'guest'],
          'profiles',
          true
        );
      END IF;
    END $$
  `.simple();
  console.log("  ✓ oauth first-party CLI client");

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
