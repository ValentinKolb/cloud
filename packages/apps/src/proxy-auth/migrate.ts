import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS proxy_auth`.simple();
  console.log("  ✓ proxy_auth schema");

  await sql`
    CREATE TABLE IF NOT EXISTS proxy_auth.clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      client_id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by UUID REFERENCES auth.users(id)
    )
  `.simple();
  console.log("  ✓ proxy_auth.clients table");

  await sql`
    CREATE TABLE IF NOT EXISTS proxy_auth.client_groups (
      client_id UUID NOT NULL REFERENCES proxy_auth.clients(id) ON DELETE CASCADE,
      group_id UUID REFERENCES auth.groups(id) ON DELETE CASCADE,
      group_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      PRIMARY KEY (client_id, group_cn)
    )
  `.simple();

  await sql`
    ALTER TABLE proxy_auth.client_groups
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES auth.groups(id) ON DELETE CASCADE
  `.simple();

  await sql`
    ALTER TABLE proxy_auth.client_groups
    DROP CONSTRAINT IF EXISTS client_groups_pkey
  `.simple();

  await sql`
    ALTER TABLE proxy_auth.client_groups
    ALTER COLUMN group_cn DROP NOT NULL
  `.simple();

  await sql`
    UPDATE proxy_auth.client_groups cg
    SET group_id = g.id
    FROM auth.groups g
    WHERE cg.group_id IS NULL
      AND cg.group_cn = g.cn
  `.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_auth_client_groups_group_id_unique
    ON proxy_auth.client_groups(client_id, group_id)
    WHERE group_id IS NOT NULL
  `.simple();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_auth_client_groups_group_cn_unique
    ON proxy_auth.client_groups(client_id, group_cn)
    WHERE group_cn IS NOT NULL
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_proxy_auth_client_groups_group
    ON proxy_auth.client_groups(group_id)
    WHERE group_id IS NOT NULL
  `.simple();
  console.log("  ✓ proxy_auth.client_groups junction table");
};
