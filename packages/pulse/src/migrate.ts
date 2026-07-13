import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.simple();
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.simple();
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
  await sql`ALTER TABLE pulse.bases ADD COLUMN IF NOT EXISTS deletion_started_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE pulse.bases ADD COLUMN IF NOT EXISTS deletion_failed_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE pulse.bases ADD COLUMN IF NOT EXISTS deletion_error TEXT`.simple();
  await sql`ALTER TABLE pulse.bases ADD COLUMN IF NOT EXISTS data_clear_started_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE pulse.bases ADD COLUMN IF NOT EXISTS data_clear_completed_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE pulse.bases ADD COLUMN IF NOT EXISTS data_clear_failed_at TIMESTAMPTZ`.simple();
  await sql`ALTER TABLE pulse.bases ADD COLUMN IF NOT EXISTS data_clear_error TEXT`.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_pulse_bases_active_updated
    ON pulse.bases(updated_at DESC)
    WHERE deletion_started_at IS NULL
  `.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.base_deletions (
      base_id UUID PRIMARY KEY REFERENCES pulse.bases(id) ON DELETE CASCADE,
      requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'deleting', 'failed')),
      phase TEXT NOT NULL DEFAULT 'queued',
      deleted_rows BIGINT NOT NULL DEFAULT 0,
      last_batch_rows INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_base_deletions_status ON pulse.base_deletions(status, updated_at)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.base_data_clears (
      base_id UUID PRIMARY KEY REFERENCES pulse.bases(id) ON DELETE CASCADE,
      requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'clearing', 'failed', 'completed')),
      phase TEXT NOT NULL DEFAULT 'queued',
      deleted_rows BIGINT NOT NULL DEFAULT 0,
      last_batch_rows INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_base_data_clears_status ON pulse.base_data_clears(status, updated_at)`.simple();

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
  await sql`DROP INDEX IF EXISTS pulse.idx_pulse_sources_ingest_token`.simple();
  await sql`ALTER TABLE pulse.sources DROP COLUMN IF EXISTS ingest_token_hash`.simple();
  await sql`DROP TABLE IF EXISTS pulse.source_tokens`.simple();

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
    CREATE TABLE IF NOT EXISTS pulse.ingest_idempotency (
      source_id UUID NOT NULL REFERENCES pulse.sources(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (source_id, idempotency_key),
      CONSTRAINT pulse_ingest_idempotency_key_length CHECK (char_length(idempotency_key) BETWEEN 1 AND 200)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_ingest_idempotency_expires ON pulse.ingest_idempotency(expires_at)`.simple();

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
  await sql`ALTER TABLE pulse.metric_series ADD COLUMN IF NOT EXISTS resource_key TEXT`.simple();
  await sql`ALTER TABLE pulse.metric_series ADD COLUMN IF NOT EXISTS resource_id TEXT`.simple();
  await sql`ALTER TABLE pulse.metric_series ADD COLUMN IF NOT EXISTS resource_type TEXT`.simple();
  await sql`ALTER TABLE pulse.metric_series ADD COLUMN IF NOT EXISTS resource_label TEXT`.simple();
  await sql`
    UPDATE pulse.metric_series
    SET series_key = COALESCE(source_id::text, '') || E'\x1f' || COALESCE(entity_id, '') || E'\x1f' || dimensions_hash
    WHERE series_key IS NULL
  `.simple();
  await sql`ALTER TABLE pulse.metric_series ALTER COLUMN series_key SET NOT NULL`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_base_metric ON pulse.metric_series(base_id, metric_id)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_source ON pulse.metric_series(source_id) WHERE source_id IS NOT NULL`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_resource ON pulse.metric_series(base_id, resource_key, last_seen_at DESC) WHERE resource_key IS NOT NULL`.simple();
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
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_dimensions_key_search ON pulse.metric_series_dimensions USING GIN (key gin_trgm_ops)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_dimensions_value_search ON pulse.metric_series_dimensions USING GIN (value gin_trgm_ops)`.simple();

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
      id UUID NOT NULL DEFAULT gen_random_uuid(),
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
      attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      sensitive JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, ts)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_base_kind_ts ON pulse.events(base_id, kind, ts DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_actor_ts ON pulse.events(base_id, actor_id, ts DESC) WHERE actor_id IS NOT NULL`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_correlation_ts ON pulse.events(base_id, correlation_id, ts DESC) WHERE correlation_id IS NOT NULL`.simple();
  await sql`ALTER TABLE pulse.events ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb`.simple();
  await sql`ALTER TABLE pulse.events ADD COLUMN IF NOT EXISTS sensitive JSONB NOT NULL DEFAULT '{}'::jsonb`.simple();
  await sql`DROP TABLE IF EXISTS pulse.event_dimensions`.simple();
  await sql`ALTER TABLE pulse.events ADD COLUMN IF NOT EXISTS resource_key TEXT`.simple();
  await sql`ALTER TABLE pulse.events ADD COLUMN IF NOT EXISTS resource_id TEXT`.simple();
  await sql`ALTER TABLE pulse.events ADD COLUMN IF NOT EXISTS resource_type TEXT`.simple();
  await sql`ALTER TABLE pulse.events ADD COLUMN IF NOT EXISTS resource_label TEXT`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_resource_ts ON pulse.events(base_id, resource_key, ts DESC) WHERE resource_key IS NOT NULL`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_ts_brin ON pulse.events USING BRIN (ts) WITH (autosummarize = on)`.simple();

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
  await sql`ALTER TABLE pulse.states_current ADD COLUMN IF NOT EXISTS resource_key TEXT`.simple();
  await sql`ALTER TABLE pulse.states_current ADD COLUMN IF NOT EXISTS resource_id TEXT`.simple();
  await sql`ALTER TABLE pulse.states_current ADD COLUMN IF NOT EXISTS resource_type TEXT`.simple();
  await sql`ALTER TABLE pulse.states_current ADD COLUMN IF NOT EXISTS resource_label TEXT`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_states_current_resource ON pulse.states_current(base_id, resource_key, updated_at DESC) WHERE resource_key IS NOT NULL`.simple();

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
  await sql`ALTER TABLE pulse.state_changes ADD COLUMN IF NOT EXISTS resource_key TEXT`.simple();
  await sql`ALTER TABLE pulse.state_changes ADD COLUMN IF NOT EXISTS resource_id TEXT`.simple();
  await sql`ALTER TABLE pulse.state_changes ADD COLUMN IF NOT EXISTS resource_type TEXT`.simple();
  await sql`ALTER TABLE pulse.state_changes ADD COLUMN IF NOT EXISTS resource_label TEXT`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_state_changes_key_ts ON pulse.state_changes(base_id, state_key, changed_at DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_state_changes_resource_ts ON pulse.state_changes(base_id, resource_key, changed_at DESC) WHERE resource_key IS NOT NULL`.simple();

  await sql`DROP TABLE IF EXISTS pulse.dimension_metadata`.simple();
  await sql`
    CREATE TABLE IF NOT EXISTS pulse.signal_fields (
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      source_id UUID NOT NULL REFERENCES pulse.sources(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('metric', 'event', 'state')),
      signal_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('dimension', 'attribute', 'sensitive')),
      key TEXT NOT NULL,
      value_type TEXT NOT NULL CHECK (value_type IN ('null', 'string', 'number', 'boolean', 'object', 'array', 'mixed')),
      observed_count BIGINT NOT NULL DEFAULT 0,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (base_id, source_id, scope, signal_name, role, key)
    )
  `.simple();
  await sql`ALTER TABLE pulse.signal_fields DROP CONSTRAINT IF EXISTS signal_fields_role_check`.simple();
  await sql`
    ALTER TABLE pulse.signal_fields
    ADD CONSTRAINT signal_fields_role_check CHECK (role IN ('dimension', 'attribute', 'sensitive'))
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_signal_fields_catalog ON pulse.signal_fields(base_id, scope, signal_name, role, key)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.observed_resources (
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      resource_key TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_type TEXT,
      label TEXT NOT NULL,
      source_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
      dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (base_id, resource_key)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_observed_resources_base_seen ON pulse.observed_resources(base_id, last_seen_at DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_observed_resources_base_type ON pulse.observed_resources(base_id, resource_type, last_seen_at DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_observed_resources_sources ON pulse.observed_resources USING GIN (source_ids)`.simple();
  await sql`ALTER TABLE pulse.observed_resources ADD COLUMN IF NOT EXISTS search_text TEXT`.simple();
  await sql`
    UPDATE pulse.observed_resources
    SET search_text = concat_ws(' ', resource_key, resource_id, resource_type, label, dimensions::text)
    WHERE search_text IS NULL
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_pulse_observed_resources_search
    ON pulse.observed_resources USING GIN (search_text gin_trgm_ops)
  `.simple();
  await sql`
    CREATE OR REPLACE FUNCTION pulse.refresh_observed_resource_search_text()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.search_text := concat_ws(' ', NEW.resource_key, NEW.resource_id, NEW.resource_type, NEW.label, NEW.dimensions::text);
      RETURN NEW;
    END $$
  `.simple();
  await sql`DROP TRIGGER IF EXISTS pulse_observed_resources_search_text ON pulse.observed_resources`.simple();
  await sql`
    CREATE TRIGGER pulse_observed_resources_search_text
    BEFORE INSERT OR UPDATE OF resource_key, resource_id, resource_type, label, dimensions
    ON pulse.observed_resources
    FOR EACH ROW EXECUTE FUNCTION pulse.refresh_observed_resource_search_text()
  `.simple();

  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_defs_name_search ON pulse.metric_defs USING GIN (name gin_trgm_ops)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_metric_series_base_source_seen ON pulse.metric_series(base_id, source_id, last_seen_at DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_base_source_ts ON pulse.events(base_id, source_id, ts DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_states_base_source_updated ON pulse.states_current(base_id, source_id, updated_at DESC)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_events_kind_search ON pulse.events USING GIN (kind gin_trgm_ops)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_states_key_search ON pulse.states_current USING GIN (state_key gin_trgm_ops)`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS pulse.dashboards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      base_id UUID NOT NULL REFERENCES pulse.bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      public_enabled BOOLEAN NOT NULL DEFAULT false,
      public_token_encrypted TEXT,
      public_token_hash TEXT UNIQUE,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`ALTER TABLE pulse.dashboards ADD COLUMN IF NOT EXISTS public_enabled BOOLEAN NOT NULL DEFAULT false`.simple();
  await sql`ALTER TABLE pulse.dashboards ADD COLUMN IF NOT EXISTS public_token_encrypted TEXT`.simple();
  await sql`ALTER TABLE pulse.dashboards ADD COLUMN IF NOT EXISTS public_token_hash TEXT UNIQUE`.simple();
  await sql`DROP INDEX IF EXISTS pulse.idx_pulse_dashboards_public_token`.simple();
  await sql`ALTER TABLE pulse.dashboards DROP COLUMN IF EXISTS public_token`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_pulse_dashboards_base ON pulse.dashboards(base_id)`.simple();
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
    UPDATE pulse.metric_series
    SET dimensions = (dimensions #>> '{}')::jsonb
    WHERE jsonb_typeof(dimensions) = 'string'
      AND left(dimensions #>> '{}', 1) = '{'
  `.simple();
  await sql`
    UPDATE pulse.events
    SET dimensions = (dimensions #>> '{}')::jsonb
    WHERE jsonb_typeof(dimensions) = 'string'
      AND left(dimensions #>> '{}', 1) = '{'
  `.simple();
  await sql`
    UPDATE pulse.events
    SET payload = (payload #>> '{}')::jsonb
    WHERE jsonb_typeof(payload) = 'string'
      AND left(payload #>> '{}', 1) = '{'
  `.simple();
  await sql`
    UPDATE pulse.states_current
    SET dimensions = (dimensions #>> '{}')::jsonb
    WHERE jsonb_typeof(dimensions) = 'string'
      AND left(dimensions #>> '{}', 1) = '{'
  `.simple();
  await sql`
    UPDATE pulse.state_changes
    SET dimensions = (dimensions #>> '{}')::jsonb
    WHERE jsonb_typeof(dimensions) = 'string'
      AND left(dimensions #>> '{}', 1) = '{'
  `.simple();

  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('pulse.metric_samples', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
        PERFORM create_hypertable('pulse.metric_rollups_hourly', 'bucket', if_not_exists => TRUE, migrate_data => TRUE);
        PERFORM create_hypertable('pulse.events', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
      END IF;
    EXCEPTION
      WHEN undefined_function THEN NULL;
      WHEN feature_not_supported THEN NULL;
    END $$
  `.simple();

  console.log("  ✓ pulse tables");
};
