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
      provider TEXT,
      profile TEXT,
      given_name TEXT NOT NULL DEFAULT '',
      sn TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      mail TEXT,
      account_expires TIMESTAMPTZ,
      ipa_account_expires TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  // kerberos_aliases column removed — dropped below in cleanup section
  await sql`
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_login_local TIMESTAMPTZ
  `.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS guest_expires_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS account_expires TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS provider TEXT`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS profile TEXT`.simple();
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT false`.simple();
  await sql`
    UPDATE auth.users
    SET provider = CASE realm
      WHEN 'ipa' THEN 'ipa'
      WHEN 'ipa-limited' THEN 'ipa'
      ELSE 'local'
    END
    WHERE provider IS NULL
  `.simple();
  await sql`
    UPDATE auth.users
    SET profile = CASE realm
      WHEN 'ipa' THEN 'user'
      WHEN 'local' THEN 'user'
      ELSE 'guest'
    END
    WHERE profile IS NULL
  `.simple();
  await sql`
    UPDATE auth.users
    SET admin = false
    WHERE provider = 'ipa' OR profile = 'guest'
  `.simple();
  await sql`ALTER TABLE auth.users ALTER COLUMN provider SET NOT NULL`.simple();
  await sql`ALTER TABLE auth.users ALTER COLUMN profile SET NOT NULL`.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_provider_check'
          AND conrelid = 'auth.users'::regclass
      ) THEN
        ALTER TABLE auth.users
        ADD CONSTRAINT users_provider_check CHECK (provider IN ('local', 'ipa'));
      END IF;
    END $$;
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_profile_check'
          AND conrelid = 'auth.users'::regclass
      ) THEN
        ALTER TABLE auth.users
        ADD CONSTRAINT users_profile_check CHECK (profile IN ('user', 'guest'));
      END IF;
    END $$;
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_admin_check'
          AND conrelid = 'auth.users'::regclass
      ) THEN
        ALTER TABLE auth.users
        ADD CONSTRAINT users_admin_check CHECK (admin = false OR (provider = 'local' AND profile = 'user'));
      END IF;
    END $$;
  `.simple();
  console.log("  ✓ auth.users table");

  // Allow the same mail address to exist once per provider.
  // Dual-stack local+IPA requires provider-scoped uniqueness, not global uniqueness.
  await sql`DROP INDEX IF EXISTS auth.idx_users_mail`.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_mail
    ON auth.users(provider, mail) WHERE mail IS NOT NULL
  `.simple();

  await sql`
    UPDATE auth.users
    SET account_expires = COALESCE(account_expires, ipa_account_expires, guest_expires_at)
    WHERE account_expires IS NULL
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
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS uid_number INTEGER`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS phone TEXT`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS employee_type TEXT`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS mobile TEXT`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS addr_street TEXT`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS addr_postal_code TEXT`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS addr_city TEXT`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS addr_state TEXT`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS ipa_password_expires TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS last_login_ipa TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS ssh_public_keys TEXT[] NOT NULL DEFAULT '{}'`.simple();
  await sql`ALTER TABLE auth.user_ipa_data ADD COLUMN IF NOT EXISTS ssh_fingerprints TEXT[] NOT NULL DEFAULT '{}'`.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_ipa_data_uid_number
    ON auth.user_ipa_data(uid_number)
    WHERE uid_number IS NOT NULL
  `.simple();
  console.log("  ✓ auth.user_ipa_data table");

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'uid_number'
      ) THEN
        INSERT INTO auth.user_ipa_data (
          user_id, uid_number, phone, employee_type, mobile, addr_street, addr_postal_code,
          addr_city, addr_state, ipa_password_expires, last_login_ipa, synced_at, ssh_public_keys, ssh_fingerprints
        )
        SELECT
          id, uid_number, phone, employee_type, mobile, addr_street, addr_postal_code,
          addr_city, addr_state, ipa_password_expires, last_login_ipa, synced_at,
          COALESCE(ssh_public_keys, '{}'::text[]), COALESCE(ssh_fingerprints, '{}'::text[])
        FROM auth.users
        WHERE provider = 'ipa'
        ON CONFLICT (user_id) DO UPDATE SET
          uid_number = EXCLUDED.uid_number,
          phone = EXCLUDED.phone,
          employee_type = EXCLUDED.employee_type,
          mobile = EXCLUDED.mobile,
          addr_street = EXCLUDED.addr_street,
          addr_postal_code = EXCLUDED.addr_postal_code,
          addr_city = EXCLUDED.addr_city,
          addr_state = EXCLUDED.addr_state,
          ipa_password_expires = EXCLUDED.ipa_password_expires,
          last_login_ipa = EXCLUDED.last_login_ipa,
          synced_at = EXCLUDED.synced_at,
          ssh_public_keys = EXCLUDED.ssh_public_keys,
          ssh_fingerprints = EXCLUDED.ssh_fingerprints;
      END IF;
    END $$;
  `.simple();

  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS uid_number`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS phone`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS employee_type`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS addr_street`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS addr_postal_code`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS addr_city`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS addr_state`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS mobile`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS ssh_public_keys`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS ssh_fingerprints`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS ipa_password_expires`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS last_login_ipa`.simple();
  await sql`ALTER TABLE auth.users DROP COLUMN IF EXISTS synced_at`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS auth.groups (
      cn TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'ipa',
      id UUID,
      name TEXT,
      description TEXT,
      gid_number INTEGER,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`ALTER TABLE auth.groups ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'ipa'`.simple();
  await sql`ALTER TABLE auth.groups ADD COLUMN IF NOT EXISTS id UUID`.simple();
  await sql`ALTER TABLE auth.groups ADD COLUMN IF NOT EXISTS name TEXT`.simple();
  await sql`UPDATE auth.groups SET provider = 'ipa' WHERE provider IS NULL`.simple();
  await sql`UPDATE auth.groups SET id = gen_random_uuid() WHERE id IS NULL`.simple();
  await sql`UPDATE auth.groups SET name = cn WHERE name IS NULL`.simple();
  await sql`
    UPDATE auth.groups
    SET cn = CONCAT('local:', COALESCE(name, id::text))
    WHERE provider = 'local'
      AND (cn IS NULL OR cn = '')
  `.simple();
  await sql`ALTER TABLE auth.groups ALTER COLUMN id SET DEFAULT gen_random_uuid()`.simple();
  await sql`ALTER TABLE auth.groups ALTER COLUMN id SET NOT NULL`.simple();
  await sql`ALTER TABLE auth.groups ALTER COLUMN name SET NOT NULL`.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'groups_provider_check'
          AND conrelid = 'auth.groups'::regclass
      ) THEN
        ALTER TABLE auth.groups
        ADD CONSTRAINT groups_provider_check CHECK (provider IN ('local', 'ipa'));
      END IF;
    END $$;
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'groups_id_unique'
          AND conrelid = 'auth.groups'::regclass
      ) THEN
        ALTER TABLE auth.groups
        ADD CONSTRAINT groups_id_unique UNIQUE (id);
      END IF;
    END $$;
  `.simple();
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'groups_provider_name_unique'
          AND conrelid = 'auth.groups'::regclass
      ) THEN
        ALTER TABLE auth.groups
        ADD CONSTRAINT groups_provider_name_unique UNIQUE (provider, name);
      END IF;
    END $$;
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
    CREATE TABLE IF NOT EXISTS auth.group_manager_groups (
      group_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      manager_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      PRIMARY KEY (group_cn, manager_cn)
    )
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

  await sql`
    CREATE INDEX IF NOT EXISTS idx_group_manager_groups_manager
    ON auth.group_manager_groups(manager_cn)
  `.simple();

  console.log("  ✓ auth.user/group junction tables");

  await sql`
    INSERT INTO auth.user_groups_v2 (user_id, group_id)
    SELECT ug.user_id, g.id
    FROM auth.user_groups ug
    JOIN auth.groups g ON g.cn = ug.group_cn
    ON CONFLICT DO NOTHING
  `.simple();

  await sql`
    INSERT INTO auth.group_groups_v2 (parent_group_id, child_group_id)
    SELECT gp.id, gc.id
    FROM auth.group_groups gg
    JOIN auth.groups gp ON gp.cn = gg.parent_cn
    JOIN auth.groups gc ON gc.cn = gg.child_cn
    ON CONFLICT DO NOTHING
  `.simple();

  await sql`
    INSERT INTO auth.group_manager_users_v2 (group_id, user_id)
    SELECT g.id, gmu.user_id
    FROM auth.group_manager_users gmu
    JOIN auth.groups g ON g.cn = gmu.group_cn
    ON CONFLICT DO NOTHING
  `.simple();

  await sql`
    INSERT INTO auth.group_manager_groups_v2 (group_id, manager_group_id)
    SELECT g.id, mg.id
    FROM auth.group_manager_groups gmg
    JOIN auth.groups g ON g.cn = gmg.group_cn
    JOIN auth.groups mg ON mg.cn = gmg.manager_cn
    ON CONFLICT DO NOTHING
  `.simple();

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
  await sql`DROP TRIGGER IF EXISTS trg_user_groups_v2_provider_guard ON auth.user_groups_v2`.simple();
  await sql`
    CREATE TRIGGER trg_user_groups_v2_provider_guard
    BEFORE INSERT OR UPDATE ON auth.user_groups_v2
    FOR EACH ROW
    EXECUTE FUNCTION auth.enforce_provider_safe_group_relations()
  `.simple();
  await sql`DROP TRIGGER IF EXISTS trg_group_groups_v2_provider_guard ON auth.group_groups_v2`.simple();
  await sql`
    CREATE TRIGGER trg_group_groups_v2_provider_guard
    BEFORE INSERT OR UPDATE ON auth.group_groups_v2
    FOR EACH ROW
    EXECUTE FUNCTION auth.enforce_provider_safe_group_relations()
  `.simple();
  await sql`DROP TRIGGER IF EXISTS trg_group_manager_users_v2_provider_guard ON auth.group_manager_users_v2`.simple();
  await sql`
    CREATE TRIGGER trg_group_manager_users_v2_provider_guard
    BEFORE INSERT OR UPDATE ON auth.group_manager_users_v2
    FOR EACH ROW
    EXECUTE FUNCTION auth.enforce_provider_safe_group_relations()
  `.simple();
  await sql`DROP TRIGGER IF EXISTS trg_group_manager_groups_v2_provider_guard ON auth.group_manager_groups_v2`.simple();
  await sql`
    CREATE TRIGGER trg_group_manager_groups_v2_provider_guard
    BEFORE INSERT OR UPDATE ON auth.group_manager_groups_v2
    FOR EACH ROW
    EXECUTE FUNCTION auth.enforce_provider_safe_group_relations()
  `.simple();

  // ----------------------------------------------------------
  // Account requests
  // ----------------------------------------------------------

  const ensureAccountRequestsCapacity = async (): Promise<void> => {
    const [tableExists] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'account_requests'
      ) AS exists
    `;
    if (!tableExists?.exists) return;

    const [stats] = await sql<{ total_columns: number; dropped_columns: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE attnum > 0) AS total_columns,
        COUNT(*) FILTER (WHERE attnum > 0 AND attisdropped) AS dropped_columns
      FROM pg_attribute
      WHERE attrelid = 'auth.account_requests'::regclass
    `;
    const totalColumns = Number(stats?.total_columns ?? 0);
    const droppedColumns = Number(stats?.dropped_columns ?? 0);

    // Guard against the historical add/drop loop that exhausts PostgreSQL's 1600-column limit.
    if (totalColumns < 1200 && droppedColumns < 128) return;

    console.log(`  ! Rebuilding auth.account_requests (total=${totalColumns}, dropped=${droppedColumns})`);

    await sql.begin(async (tx) => {
      await tx`DROP TABLE IF EXISTS auth.account_requests_rebuild`.simple();
      await tx`
        CREATE TABLE auth.account_requests_rebuild (
          id UUID PRIMARY KEY,
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

      await tx`
        INSERT INTO auth.account_requests_rebuild (id, user_id, phone, comment, accepted_agb, status, denied_reason, processed_at, processed_by, created_at)
        SELECT
          COALESCE(NULLIF(data->>'id', '')::uuid, gen_random_uuid()) AS id,
          NULLIF(data->>'user_id', '')::uuid AS user_id,
          NULLIF(data->>'phone', '') AS phone,
          NULLIF(data->>'comment', '') AS comment,
          COALESCE(NULLIF(data->>'accepted_agb', '')::boolean, false) AS accepted_agb,
          COALESCE(NULLIF(data->>'status', ''), 'pending') AS status,
          NULLIF(data->>'denied_reason', '') AS denied_reason,
          NULLIF(data->>'processed_at', '')::timestamptz AS processed_at,
          NULLIF(data->>'processed_by', '')::uuid AS processed_by,
          COALESCE(NULLIF(data->>'created_at', '')::timestamptz, now()) AS created_at
        FROM (
          SELECT to_jsonb(ar) AS data
          FROM auth.account_requests ar
        ) src
      `.simple();

      await tx`DROP TABLE IF EXISTS auth.account_requests_backup`.simple();
      await tx`CREATE TABLE auth.account_requests_backup AS TABLE auth.account_requests`.simple();
      await tx`DROP TABLE auth.account_requests`.simple();
      await tx`ALTER TABLE auth.account_requests_rebuild RENAME TO account_requests`.simple();
    });

    console.log("  ✓ Rebuilt auth.account_requests (backup: auth.account_requests_backup)");
  };

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

  await ensureAccountRequestsCapacity();

  // Add new columns if they don't exist (for existing installations)
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS phone TEXT`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS comment TEXT`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS accepted_agb BOOLEAN NOT NULL DEFAULT false`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS denied_reason TEXT`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES auth.users(id)`.simple();
  await sql`ALTER TABLE auth.account_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.simple();
  await sql`ALTER TABLE auth.account_requests ALTER COLUMN id SET DEFAULT gen_random_uuid()`.simple();

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
      group_id UUID REFERENCES auth.groups(id) ON DELETE CASCADE,
      group_cn TEXT REFERENCES auth.groups(cn) ON DELETE CASCADE,
      authenticated_only BOOLEAN NOT NULL DEFAULT false,

      -- Permission level
      permission auth.permission_level NOT NULL DEFAULT 'read',

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Exactly one principal type
      CONSTRAINT principal_check CHECK (
        (user_id IS NOT NULL AND group_id IS NULL AND authenticated_only = false) OR
        (user_id IS NULL AND group_id IS NOT NULL AND authenticated_only = false) OR
        (user_id IS NULL AND group_id IS NULL AND authenticated_only = true) OR
        (user_id IS NULL AND group_id IS NULL AND authenticated_only = false)
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
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES auth.groups(id) ON DELETE CASCADE
  `.simple();

  await sql`
    UPDATE auth.access a
    SET group_id = g.id
    FROM auth.groups g
    WHERE a.group_id IS NULL
      AND a.group_cn = g.cn
  `.simple();

  await sql`
    ALTER TABLE auth.access
    DROP CONSTRAINT IF EXISTS principal_check
  `.simple();

  await sql`
    ALTER TABLE auth.access
    ADD CONSTRAINT principal_check CHECK (
      (user_id IS NOT NULL AND group_id IS NULL AND authenticated_only = false) OR
      (user_id IS NULL AND group_id IS NOT NULL AND authenticated_only = false) OR
      (user_id IS NULL AND group_id IS NULL AND authenticated_only = true) OR
      (user_id IS NULL AND group_id IS NULL AND authenticated_only = false)
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

  await sql`DROP INDEX IF EXISTS auth.idx_access_public`.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_public
    ON auth.access(id) WHERE user_id IS NULL AND group_id IS NULL AND authenticated_only = false
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_access_authenticated
    ON auth.access(id) WHERE user_id IS NULL AND group_id IS NULL AND authenticated_only = true
  `.simple();

  // ----------------------------------------------------------
  // Account lifecycle audit
  // ----------------------------------------------------------

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
    ALTER TABLE auth.account_lifecycle_reminders
    ADD COLUMN IF NOT EXISTS uid TEXT
  `.simple();
  await sql`
    ALTER TABLE auth.account_lifecycle_reminders
    ADD COLUMN IF NOT EXISTS mail TEXT
  `.simple();
  await sql`
    ALTER TABLE auth.account_lifecycle_reminders
    ADD COLUMN IF NOT EXISTS display_name TEXT
  `.simple();
  await sql`
    ALTER TABLE auth.account_lifecycle_reminders
    ALTER COLUMN user_id DROP NOT NULL
  `.simple();
  await sql`
    ALTER TABLE auth.account_lifecycle_reminders
    DROP CONSTRAINT IF EXISTS account_lifecycle_reminders_user_id_fkey
  `.simple();
  await sql`
    ALTER TABLE auth.account_lifecycle_reminders
    ADD CONSTRAINT account_lifecycle_reminders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
  `.simple();
  await sql`
    UPDATE auth.account_lifecycle_reminders r
    SET uid = u.uid,
        mail = u.mail,
        display_name = u.display_name
    FROM auth.users u
    WHERE r.user_id = u.id
      AND (r.uid IS NULL OR r.mail IS NULL OR r.display_name IS NULL)
  `.simple();
  await sql`DROP INDEX IF EXISTS auth.uq_account_lifecycle_reminders_target`.simple();
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
};
