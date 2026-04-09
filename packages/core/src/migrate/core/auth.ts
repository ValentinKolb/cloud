import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS auth`.simple();
  console.log("  ✓ auth schema");

  await sql`
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uid TEXT NOT NULL UNIQUE,
      realm TEXT NOT NULL DEFAULT 'ipa',
      provider TEXT NOT NULL,
      profile TEXT NOT NULL,
      given_name TEXT NOT NULL DEFAULT '',
      sn TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      mail TEXT,
      account_expires TIMESTAMPTZ,
      ipa_account_expires TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_local TIMESTAMPTZ,
      guest_expires_at TIMESTAMPTZ,
      admin BOOLEAN NOT NULL DEFAULT false,
      CONSTRAINT users_provider_check CHECK (provider IN ('local', 'ipa')),
      CONSTRAINT users_profile_check CHECK (profile IN ('user', 'guest')),
      CONSTRAINT users_admin_check CHECK (admin = false OR (provider = 'local' AND profile = 'user'))
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_mail
    ON auth.users(provider, mail) WHERE mail IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_realm
    ON auth.users(realm)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_provider_profile
    ON auth.users(provider, profile)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_account_expires
    ON auth.users(account_expires)
    WHERE account_expires IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_guest_expires
    ON auth.users(guest_expires_at)
    WHERE realm = 'guest' AND guest_expires_at IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_local_guest_expires
    ON auth.users(guest_expires_at)
    WHERE provider = 'local' AND profile = 'guest' AND guest_expires_at IS NOT NULL
  `.simple();
  console.log("  ✓ auth.users table");

  await sql`
    CREATE TABLE IF NOT EXISTS auth.user_ipa_data (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      uid_number INTEGER,
      phone TEXT,
      employee_type TEXT,
      mobile TEXT,
      addr_street TEXT,
      addr_postal_code TEXT,
      addr_city TEXT,
      addr_state TEXT,
      ipa_password_expires TIMESTAMPTZ,
      last_login_ipa TIMESTAMPTZ,
      synced_at TIMESTAMPTZ,
      ssh_public_keys TEXT[] NOT NULL DEFAULT '{}',
      ssh_fingerprints TEXT[] NOT NULL DEFAULT '{}'
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_ipa_data_uid_number
    ON auth.user_ipa_data(uid_number)
    WHERE uid_number IS NOT NULL
  `.simple();
  console.log("  ✓ auth.user_ipa_data table");

  await sql`
    CREATE TABLE IF NOT EXISTS auth.groups (
      cn TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'ipa',
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      gid_number INTEGER,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT groups_provider_check CHECK (provider IN ('local', 'ipa')),
      CONSTRAINT groups_id_unique UNIQUE (id),
      CONSTRAINT groups_provider_name_unique UNIQUE (provider, name)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_groups_provider
    ON auth.groups(provider)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_groups_name
    ON auth.groups(name)
  `.simple();
  console.log("  ✓ auth.groups table");

  await sql`
    CREATE TABLE IF NOT EXISTS auth.user_groups_v2 (
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      group_id UUID NOT NULL REFERENCES auth.groups(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, group_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_groups_v2_group
    ON auth.user_groups_v2(group_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_groups_v2_user
    ON auth.user_groups_v2(user_id)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.group_groups_v2 (
      parent_group_id UUID NOT NULL REFERENCES auth.groups(id) ON DELETE CASCADE,
      child_group_id UUID NOT NULL REFERENCES auth.groups(id) ON DELETE CASCADE,
      PRIMARY KEY (parent_group_id, child_group_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_group_groups_v2_child
    ON auth.group_groups_v2(child_group_id)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.group_manager_users_v2 (
      group_id UUID NOT NULL REFERENCES auth.groups(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_group_manager_users_v2_user
    ON auth.group_manager_users_v2(user_id)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.group_manager_groups_v2 (
      group_id UUID NOT NULL REFERENCES auth.groups(id) ON DELETE CASCADE,
      manager_group_id UUID NOT NULL REFERENCES auth.groups(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, manager_group_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_group_manager_groups_v2_manager
    ON auth.group_manager_groups_v2(manager_group_id)
  `.simple();
  console.log("  ✓ auth.user/group junction tables");

  await sql`
    CREATE OR REPLACE FUNCTION auth.enforce_provider_safe_group_relations()
    RETURNS trigger AS $$
    DECLARE
      target_group_provider TEXT;
      related_user_provider TEXT;
      related_group_provider TEXT;
    BEGIN
      IF TG_TABLE_NAME = 'user_groups_v2' THEN
        SELECT provider INTO target_group_provider FROM auth.groups WHERE id = NEW.group_id;
        IF target_group_provider = 'ipa' THEN
          SELECT provider INTO related_user_provider FROM auth.users WHERE id = NEW.user_id;
          IF related_user_provider IS DISTINCT FROM 'ipa' THEN
            RAISE EXCEPTION 'IPA groups may only contain IPA users';
          END IF;
        END IF;
        RETURN NEW;
      END IF;

      IF TG_TABLE_NAME = 'group_groups_v2' THEN
        SELECT provider INTO target_group_provider FROM auth.groups WHERE id = NEW.parent_group_id;
        SELECT provider INTO related_group_provider FROM auth.groups WHERE id = NEW.child_group_id;
        IF target_group_provider IS DISTINCT FROM related_group_provider THEN
          RAISE EXCEPTION 'Group nesting must stay within the same provider tree';
        END IF;
        RETURN NEW;
      END IF;

      IF TG_TABLE_NAME = 'group_manager_users_v2' THEN
        SELECT provider INTO target_group_provider FROM auth.groups WHERE id = NEW.group_id;
        IF target_group_provider = 'ipa' THEN
          SELECT provider INTO related_user_provider FROM auth.users WHERE id = NEW.user_id;
          IF related_user_provider IS DISTINCT FROM 'ipa' THEN
            RAISE EXCEPTION 'IPA groups may only be managed by IPA users';
          END IF;
        END IF;
        RETURN NEW;
      END IF;

      IF TG_TABLE_NAME = 'group_manager_groups_v2' THEN
        SELECT provider INTO target_group_provider FROM auth.groups WHERE id = NEW.group_id;
        SELECT provider INTO related_group_provider FROM auth.groups WHERE id = NEW.manager_group_id;
        IF target_group_provider IS DISTINCT FROM related_group_provider THEN
          RAISE EXCEPTION 'Group manager relations must stay within the same provider tree';
        END IF;
        RETURN NEW;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_user_groups_v2_provider_guard'
          AND tgrelid = 'auth.user_groups_v2'::regclass
      ) THEN
        CREATE TRIGGER trg_user_groups_v2_provider_guard
        BEFORE INSERT OR UPDATE ON auth.user_groups_v2
        FOR EACH ROW
        EXECUTE FUNCTION auth.enforce_provider_safe_group_relations();
      END IF;
    END $$;
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_group_groups_v2_provider_guard'
          AND tgrelid = 'auth.group_groups_v2'::regclass
      ) THEN
        CREATE TRIGGER trg_group_groups_v2_provider_guard
        BEFORE INSERT OR UPDATE ON auth.group_groups_v2
        FOR EACH ROW
        EXECUTE FUNCTION auth.enforce_provider_safe_group_relations();
      END IF;
    END $$;
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_group_manager_users_v2_provider_guard'
          AND tgrelid = 'auth.group_manager_users_v2'::regclass
      ) THEN
        CREATE TRIGGER trg_group_manager_users_v2_provider_guard
        BEFORE INSERT OR UPDATE ON auth.group_manager_users_v2
        FOR EACH ROW
        EXECUTE FUNCTION auth.enforce_provider_safe_group_relations();
      END IF;
    END $$;
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_group_manager_groups_v2_provider_guard'
          AND tgrelid = 'auth.group_manager_groups_v2'::regclass
      ) THEN
        CREATE TRIGGER trg_group_manager_groups_v2_provider_guard
        BEFORE INSERT OR UPDATE ON auth.group_manager_groups_v2
        FOR EACH ROW
        EXECUTE FUNCTION auth.enforce_provider_safe_group_relations();
      END IF;
    END $$;
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.account_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  await sql`
    CREATE INDEX IF NOT EXISTS idx_account_requests_user
    ON auth.account_requests(user_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_account_requests_status
    ON auth.account_requests(status)
  `.simple();
  console.log("  ✓ auth.account_requests table");

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
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      group_id UUID REFERENCES auth.groups(id) ON DELETE CASCADE,
      group_cn TEXT REFERENCES auth.groups(cn) ON DELETE CASCADE,
      authenticated_only BOOLEAN NOT NULL DEFAULT false,
      permission auth.permission_level NOT NULL DEFAULT 'read',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT principal_check CHECK (
        (user_id IS NOT NULL AND group_id IS NULL AND authenticated_only = false) OR
        (user_id IS NULL AND group_id IS NOT NULL AND authenticated_only = false) OR
        (user_id IS NULL AND group_id IS NULL AND authenticated_only = true) OR
        (user_id IS NULL AND group_id IS NULL AND authenticated_only = false)
      )
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_user
    ON auth.access(user_id) WHERE user_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_group
    ON auth.access(group_id) WHERE group_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_public
    ON auth.access(id) WHERE user_id IS NULL AND group_id IS NULL AND authenticated_only = false
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_authenticated
    ON auth.access(id) WHERE user_id IS NULL AND group_id IS NULL AND authenticated_only = true
  `.simple();
  console.log("  ✓ auth.access table");

  await sql`
    CREATE TABLE IF NOT EXISTS auth.deleted_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deleted_user_id UUID NOT NULL,
      uid TEXT NOT NULL,
      mail TEXT,
      display_name TEXT,
      previous_realm TEXT,
      reason TEXT NOT NULL,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      meta JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_deleted_accounts_deleted_at
    ON auth.deleted_accounts(deleted_at DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_deleted_accounts_reason
    ON auth.deleted_accounts(reason)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_deleted_accounts_uid
    ON auth.deleted_accounts(uid)
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.account_lifecycle_reminders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      threshold_days INTEGER NOT NULL,
      target_expiry_at TIMESTAMPTZ NOT NULL,
      uid TEXT,
      mail TEXT,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_account_lifecycle_reminders_target
    ON auth.account_lifecycle_reminders(user_id, kind, threshold_days, target_expiry_at)
    WHERE user_id IS NOT NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_account_lifecycle_reminders_status
    ON auth.account_lifecycle_reminders(status)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_account_lifecycle_reminders_created_at
    ON auth.account_lifecycle_reminders(created_at DESC)
  `.simple();
  console.log("  ✓ auth.account_lifecycle_reminders table");
};
