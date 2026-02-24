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
      group_cn TEXT NOT NULL REFERENCES auth.groups(cn) ON DELETE CASCADE,
      PRIMARY KEY (client_id, group_cn)
    )
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_proxy_auth_client_groups_group
    ON proxy_auth.client_groups(group_cn)
  `.simple();
  console.log("  ✓ proxy_auth.client_groups junction table");
};
