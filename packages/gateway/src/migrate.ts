import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.simple();
  await sql`CREATE SCHEMA IF NOT EXISTS gateway`.simple();
  console.log("  ✓ gateway schema");

  await sql`
    CREATE TABLE IF NOT EXISTS gateway.registered_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      description TEXT NOT NULL,
      base_url TEXT NOT NULL,
      routes JSONB NOT NULL DEFAULT '[]'::jsonb,
      nav JSONB,
      search JSONB,
      legal_links JSONB,
      widgets JSONB,
      openapi TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      removed_at TIMESTAMPTZ,
      last_offline_logged_at TIMESTAMPTZ
    )
  `.simple();
  console.log("  ✓ gateway.registered_apps table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gateway_registered_apps_last_seen
    ON gateway.registered_apps(last_seen_at DESC)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_gateway_registered_apps_removed
    ON gateway.registered_apps(removed_at)
  `.simple();
  console.log("  ✓ gateway registered app indexes");

  await sql`
    CREATE TABLE IF NOT EXISTS gateway.health_webhooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      enabled BOOLEAN NOT NULL DEFAULT true,
      scope_kind TEXT NOT NULL DEFAULT 'all',
      scope_app_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      send_on JSONB NOT NULL DEFAULT '["error","recovery"]'::jsonb,
      min_status TEXT NOT NULL DEFAULT 'error',
      repeat_interval_ms INTEGER NOT NULL DEFAULT 1800000,
      timeout_ms INTEGER NOT NULL DEFAULT 5000,
      last_status TEXT,
      last_sent_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_error_at TIMESTAMPTZ,
      last_error TEXT,
      delivery_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ gateway.health_webhooks table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gateway_health_webhooks_enabled
    ON gateway.health_webhooks(enabled)
  `.simple();
  console.log("  ✓ gateway health webhook indexes");
};
