import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.simple();
  await sql`CREATE SCHEMA IF NOT EXISTS pulse`.simple();
  console.log("  ✓ pulse schema");

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.bases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      retention_days INTEGER NOT NULL DEFAULT 30,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`ALTER TABLE pulse.bases ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 30`.simple();
  await sql`
    DO $$ BEGIN
      ALTER TABLE pulse.bases
      ADD CONSTRAINT pulse_bases_retention_days_check CHECK (retention_days BETWEEN 1 AND 3650);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_bases_created_by ON pulse.bases(created_by)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.base_access (
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (base_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_base_access_access ON pulse.base_access(access_id)`.simple();

  await sql`
    DO $$ BEGIN
      CREATE TYPE pulse.source_kind AS ENUM ('metrics', 'http_ingest', 'internal');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      kind pulse.source_kind NOT NULL,
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      endpoint_url TEXT,
      bearer_token_encrypted TEXT,
      ingest_token_hash TEXT UNIQUE,
      scrape_interval_seconds INTEGER,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_seen_at TIMESTAMPTZ,
      last_error TEXT,
      last_error_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT pulse_sources_scrape_interval_check CHECK (scrape_interval_seconds IS NULL OR scrape_interval_seconds >= 10)
    )
  `.simple();
  await sql`ALTER TABLE pulse.sources ADD COLUMN IF NOT EXISTS last_error TEXT`.simple();
  await sql`ALTER TABLE pulse.sources ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_sources_base ON pulse.sources(base_id, kind)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_sources_ingest_token ON pulse.sources(ingest_token_hash) WHERE ingest_token_hash IS NOT NULL`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.source_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id UUID NOT NULL REFERENCES pulse.sources(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_source_tokens_source ON pulse.source_tokens(source_id, created_at DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_source_tokens_hash ON pulse.source_tokens(token_hash)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.source_scrapes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      source_id UUID NOT NULL REFERENCES pulse.sources(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL,
      duration_ms INTEGER NOT NULL,
      success BOOLEAN NOT NULL,
      metrics_count INTEGER NOT NULL DEFAULT 0,
      events_count INTEGER NOT NULL DEFAULT 0,
      states_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_source_scrapes_source_started ON pulse.source_scrapes(source_id, started_at DESC)`.simple();

  await sql`
    DO $$ BEGIN
      CREATE TYPE pulse.metric_type AS ENUM ('gauge', 'counter', 'histogram', 'summary');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.metric_defs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      unit TEXT,
      type pulse.metric_type NOT NULL DEFAULT 'gauge',
      default_aggregation TEXT NOT NULL DEFAULT 'avg',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (base_id, name)
    )
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.metric_series (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      metric_id UUID NOT NULL REFERENCES pulse.metric_defs(id) ON DELETE CASCADE,
      source_id UUID REFERENCES pulse.sources(id) ON DELETE SET NULL,
      entity_id TEXT,
      entity_type TEXT,
      series_key TEXT NOT NULL,
      dimensions_hash TEXT NOT NULL,
      dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ,
      UNIQUE (base_id, metric_id, source_id, entity_id, dimensions_hash)
    )
  `.simple();
  await sql`ALTER TABLE pulse.metric_series ADD COLUMN IF NOT EXISTS series_key TEXT`.simple();
  await sql`
    UPDATE pulse.metric_series
    SET series_key = COALESCE(source_id::text, '') || E'\x1f' || COALESCE(entity_id, '') || E'\x1f' || dimensions_hash
    WHERE series_key IS NULL
  `.simple();
  await sql`ALTER TABLE pulse.metric_series ALTER COLUMN series_key SET NOT NULL`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_base_metric ON pulse.metric_series(base_id, metric_id)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_source ON pulse.metric_series(source_id) WHERE source_id IS NOT NULL`.simple();
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_metric_series_unique_key ON pulse.metric_series(base_id, metric_id, series_key)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.metric_series_dimensions (
      series_id UUID NOT NULL REFERENCES pulse.metric_series(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (series_id, key)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_dimensions_lookup ON pulse.metric_series_dimensions(key, value, series_id)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.metric_samples (
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      series_id UUID NOT NULL REFERENCES pulse.metric_series(id) ON DELETE CASCADE,
      ts TIMESTAMPTZ NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (series_id, ts)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_samples_base_ts ON pulse.metric_samples(base_id, ts DESC)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.metric_rollups_hourly (
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      series_id UUID NOT NULL REFERENCES pulse.metric_series(id) ON DELETE CASCADE,
      bucket TIMESTAMPTZ NOT NULL,
      sample_count BIGINT NOT NULL,
      value_sum DOUBLE PRECISION NOT NULL,
      value_min DOUBLE PRECISION NOT NULL,
      value_max DOUBLE PRECISION NOT NULL,
      last_value DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (series_id, bucket)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_rollups_hourly_base_bucket ON pulse.metric_rollups_hourly(base_id, bucket DESC)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      source_id UUID REFERENCES pulse.sources(id) ON DELETE SET NULL,
      ts TIMESTAMPTZ NOT NULL,
      kind TEXT NOT NULL,
      value DOUBLE PRECISION,
      entity_id TEXT,
      entity_type TEXT,
      actor_id TEXT,
      session_id TEXT,
      correlation_id TEXT,
      dimensions_hash TEXT NOT NULL,
      dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_base_kind_ts ON pulse.events(base_id, kind, ts DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_actor_ts ON pulse.events(base_id, actor_id, ts DESC) WHERE actor_id IS NOT NULL`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_correlation_ts ON pulse.events(base_id, correlation_id, ts DESC) WHERE correlation_id IS NOT NULL`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.event_dimensions (
      event_id UUID NOT NULL REFERENCES pulse.events(id) ON DELETE CASCADE,
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (event_id, key)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_event_dimensions_lookup ON pulse.event_dimensions(base_id, key, value, event_id)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.states_current (
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      state_key TEXT NOT NULL,
      source_id UUID REFERENCES pulse.sources(id) ON DELETE SET NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      entity_type TEXT,
      value JSONB NOT NULL,
      dimensions_hash TEXT NOT NULL,
      dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (base_id, state_key, entity_id, dimensions_hash)
    )
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.state_changes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      state_key TEXT NOT NULL,
      source_id UUID REFERENCES pulse.sources(id) ON DELETE SET NULL,
      entity_id TEXT,
      entity_type TEXT,
      value JSONB NOT NULL,
      dimensions_hash TEXT NOT NULL,
      dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
      changed_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_state_changes_key_ts ON pulse.state_changes(base_id, state_key, changed_at DESC)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.dimension_metadata (
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      source_id UUID REFERENCES pulse.sources(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('metric', 'event', 'state')),
      key TEXT NOT NULL,
      observed_cardinality INTEGER NOT NULL DEFAULT 0,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      query_count INTEGER NOT NULL DEFAULT 0,
      index_status TEXT NOT NULL DEFAULT 'generic' CHECK (index_status IN ('generic', 'hot', 'high_cardinality')),
      PRIMARY KEY (base_id, source_id, scope, key)
    )
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.dashboards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      public_enabled BOOLEAN NOT NULL DEFAULT false,
      public_token TEXT UNIQUE,
      public_token_hash TEXT UNIQUE,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`ALTER TABLE pulse.dashboards ADD COLUMN IF NOT EXISTS public_enabled BOOLEAN NOT NULL DEFAULT false`.simple();
  await sql`ALTER TABLE pulse.dashboards ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE`.simple();
  await sql`ALTER TABLE pulse.dashboards ADD COLUMN IF NOT EXISTS public_token_hash TEXT UNIQUE`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_dashboards_base ON pulse.dashboards(base_id)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_dashboards_public_token ON pulse.dashboards(public_token) WHERE public_enabled = TRUE AND public_token IS NOT NULL`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_dashboards_public ON pulse.dashboards(public_token_hash) WHERE public_enabled = TRUE AND public_token_hash IS NOT NULL`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.saved_queries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      query TEXT NOT NULL,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_saved_queries_base_updated ON pulse.saved_queries(base_id, updated_at DESC)`.simple();

  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('pulse.metric_samples', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
        PERFORM create_hypertable('pulse.metric_rollups_hourly', 'bucket', if_not_exists => TRUE, migrate_data => TRUE);
      END IF;
    EXCEPTION
      WHEN undefined_function THEN NULL;
      WHEN feature_not_supported THEN NULL;
    END $$
  `.simple();

  console.log("  ✓ pulse tables");
};
