import { sql } from "bun";

// ==========================
// Schema: auth
// ==========================

/**
 * Creates the auth schema and all related tables.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS auth`.simple();
  console.log("  ✓ auth schema");

  // ----------------------------------------------------------
  // Core identity tables (synced from FreeIPA)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uid TEXT NOT NULL UNIQUE,
      realm TEXT NOT NULL DEFAULT 'ipa',
      given_name TEXT NOT NULL DEFAULT '',
      sn TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      mail TEXT,
      phone TEXT,
      ipa_account_expires TIMESTAMPTZ,
      ipa_password_expires TIMESTAMPTZ,
      synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS ipa_password_expires TIMESTAMPTZ
  `.simple();
  // kerberos_aliases column removed — dropped below in cleanup section
  await sql`
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_login_ipa TIMESTAMPTZ
  `.simple();
  await sql`
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_login_local TIMESTAMPTZ
  `.simple();
  await sql`
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS uid_number INTEGER
  `.simple();
  // IPA extended attributes (synced from FreeIPA, cleared on demote to guest)
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS employee_type TEXT`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS address`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS addr_street TEXT`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS addr_postal_code TEXT`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS addr_city TEXT`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS addr_state TEXT`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS mobile TEXT`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS ssh_public_keys TEXT[] DEFAULT '{}'`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS ssh_fingerprints TEXT[] DEFAULT '{}'`.simple();
  console.log("  ✓ auth.users table");

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mail
    ON auth.users(mail) WHERE mail IS NOT NULL
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_realm
    ON auth.users(realm)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.groups (
      cn TEXT PRIMARY KEY,
      description TEXT,
      gid_number INTEGER,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ auth.groups table");

  await sql`
    CREATE TABLE IF NOT EXISTS auth.hosts (
      fqdn TEXT PRIMARY KEY,
      description TEXT,
      location TEXT,
      locality TEXT,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  // Host extended attributes (synced from FreeIPA)
  await sql`ALTER TABLE auth.hosts ADD COLUMN IF NOT EXISTS mac_address TEXT[] DEFAULT '{}'`.simple();
  await sql`ALTER TABLE auth.hosts ADD COLUMN IF NOT EXISTS platform TEXT`.simple();
  await sql`ALTER TABLE auth.hosts ADD COLUMN IF NOT EXISTS os_version TEXT`.simple();
  await sql`ALTER TABLE auth.hosts ADD COLUMN IF NOT EXISTS ssh_fingerprints TEXT[] DEFAULT '{}'`.simple();
  console.log("  ✓ auth.hosts table");

  await sql`
    CREATE TABLE IF NOT EXISTS auth.hostgroups (
      cn TEXT PRIMARY KEY,
      description TEXT,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ auth.hostgroups table");

  // ----------------------------------------------------------
  // User <-> Group junction tables
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS auth.user_groups (
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      group_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      PRIMARY KEY (user_id, group_cn)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_groups_group
    ON auth.user_groups(group_cn)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_groups_user
    ON auth.user_groups(user_id)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.group_groups (
      parent_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      child_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      PRIMARY KEY (parent_cn, child_cn)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_group_groups_child
    ON auth.group_groups(child_cn)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.group_manager_users (
      group_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_cn, user_id)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_group_manager_users_user
    ON auth.group_manager_users(user_id)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.group_manager_groups (
      group_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      manager_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      PRIMARY KEY (group_cn, manager_cn)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_group_manager_groups_manager
    ON auth.group_manager_groups(manager_cn)
  `.simple();

  console.log("  ✓ auth.user/group junction tables");

  // ----------------------------------------------------------
  // Host <-> Hostgroup junction tables
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS auth.host_hostgroups (
      host_fqdn TEXT NOT NULL REFERENCES auth.hosts(fqdn) ON DELETE CASCADE,
      hostgroup_cn TEXT NOT NULL REFERENCES auth.hostgroups(cn) ON DELETE CASCADE,
      PRIMARY KEY (host_fqdn, hostgroup_cn)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_host_hostgroups_hostgroup
    ON auth.host_hostgroups(hostgroup_cn)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.hostgroup_hostgroups (
      parent_cn TEXT NOT NULL REFERENCES auth.hostgroups(cn) ON DELETE CASCADE,
      child_cn TEXT NOT NULL REFERENCES auth.hostgroups(cn) ON DELETE CASCADE,
      PRIMARY KEY (parent_cn, child_cn)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_hostgroup_hostgroups_child
    ON auth.hostgroup_hostgroups(child_cn)
  `.simple();

  console.log("  ✓ auth.host/hostgroup junction tables");

  // ----------------------------------------------------------
  // Account requests
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS auth.account_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      display_name TEXT,
      phone TEXT,
      comment TEXT,
      accepted_agb BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'pending',
      denied_reason TEXT,
      processed_at TIMESTAMPTZ,
      processed_by UUID REFERENCES auth.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();

  // Add new columns if they don't exist (for existing installations)
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS display_name TEXT`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS phone TEXT`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS denied_reason TEXT`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES auth.users(id)`.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_account_requests_user
    ON auth.account_requests(user_id)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_account_requests_status
    ON auth.account_requests(status)
  `.simple();

  // Drop legacy columns from account_requests (profile data now lives on the user)
  await sql`ALTER TABLE auth.account_requests DROP COLUMN IF EXISTS email`.simple();
  await sql`ALTER TABLE auth.account_requests DROP COLUMN IF EXISTS first_name`.simple();
  await sql`ALTER TABLE auth.account_requests DROP COLUMN IF EXISTS last_name`.simple();
  await sql`ALTER TABLE auth.account_requests DROP COLUMN IF EXISTS display_name`.simple();
  await sql`ALTER TABLE auth.account_requests DROP COLUMN IF EXISTS phone`.simple();

  // Drop kerberos_aliases from users (no longer used)
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS kerberos_aliases`.simple();

  console.log("  ✓ auth.account_requests table");

  // ----------------------------------------------------------
  // Access Control (generic permission system)
  // ----------------------------------------------------------

  // Permission levels as ENUM (ordered for <= comparisons)
  // 'none' < 'read' < 'write' < 'admin'
  await sql`
    DO $$ BEGIN
      CREATE TYPE auth.permission_level AS ENUM ('none', 'read', 'write', 'admin');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `.simple();
  console.log("  ✓ auth.permission_level enum");

  await sql`
    CREATE TABLE IF NOT EXISTS auth.access (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Principal: User OR Group OR Public/Authenticated (both NULL)
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      group_cn TEXT REFERENCES auth.groups(cn) ON DELETE CASCADE,
      authenticated_only BOOLEAN NOT NULL DEFAULT false,

      -- Permission level
      permission auth.permission_level NOT NULL DEFAULT 'read',

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Exactly one principal type
      CONSTRAINT principal_check CHECK (
        (user_id IS NOT NULL AND group_cn IS NULL AND authenticated_only = false) OR
        (user_id IS NULL AND group_cn IS NOT NULL AND authenticated_only = false) OR
        (user_id IS NULL AND group_cn IS NULL AND authenticated_only = true) OR
        (user_id IS NULL AND group_cn IS NULL AND authenticated_only = false)
      )
    )
  `.simple();
  console.log("  ✓ auth.access table");

  await sql`
    ALTER TABLE auth.access
    ADD COLUMN IF NOT EXISTS authenticated_only BOOLEAN NOT NULL DEFAULT false
  `.simple();

  await sql`
    ALTER TABLE auth.access
    DROP CONSTRAINT IF EXISTS principal_check
  `.simple();

  await sql`
    ALTER TABLE auth.access
    ADD CONSTRAINT principal_check CHECK (
      (user_id IS NOT NULL AND group_cn IS NULL AND authenticated_only = false) OR
      (user_id IS NULL AND group_cn IS NOT NULL AND authenticated_only = false) OR
      (user_id IS NULL AND group_cn IS NULL AND authenticated_only = true) OR
      (user_id IS NULL AND group_cn IS NULL AND authenticated_only = false)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_user
    ON auth.access(user_id) WHERE user_id IS NOT NULL
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_group
    ON auth.access(group_cn) WHERE group_cn IS NOT NULL
  `.simple();

  await sql`DROP INDEX IF EXISTS auth.idx_access_public`.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_public
    ON auth.access(id) WHERE user_id IS NULL AND group_cn IS NULL AND authenticated_only = false
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_authenticated
    ON auth.access(id) WHERE user_id IS NULL AND group_cn IS NULL AND authenticated_only = true
  `.simple();
};
