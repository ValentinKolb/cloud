import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS venue`.simple();
  console.log("  ✓ venue schema");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.venues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'ti ti-building-carousel',
      description TEXT,
      timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
      open_mode TEXT NOT NULL DEFAULT 'combined' CHECK (open_mode IN ('regular', 'staffed', 'combined')),
      signup_mode TEXT NOT NULL DEFAULT 'both' CHECK (signup_mode IN ('templates', 'free', 'both')),
      public_enabled BOOLEAN NOT NULL DEFAULT true,
      feedback_enabled BOOLEAN NOT NULL DEFAULT true,
      accent_color TEXT NOT NULL DEFAULT '#2563eb',
      logo_base64 TEXT,
      banner_base64 TEXT,
      ical_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`ALTER TABLE IF EXISTS venue.venues ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT 'ti ti-building-carousel'`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_venues_slug ON venue.venues(slug)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_venues_ical_token ON venue.venues(ical_token)`.simple();
  console.log("  ✓ venue.venues table");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.venue_access (
      venue_id UUID NOT NULL REFERENCES venue.venues(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (venue_id, access_id)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_access_access ON venue.venue_access(access_id)`.simple();
  console.log("  ✓ venue.venue_access table");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.opening_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id UUID NOT NULL REFERENCES venue.venues(id) ON DELETE CASCADE,
      weekday INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      note TEXT,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (start_time < end_time)
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_opening_rules_venue_weekday ON venue.opening_rules(venue_id, weekday, start_time)`.simple();
  console.log("  ✓ venue.opening_rules table");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.date_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id UUID NOT NULL REFERENCES venue.venues(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('closed', 'open')),
      start_time TIME,
      end_time TIME,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (venue_id, date),
      CHECK (
        (kind = 'closed' AND start_time IS NULL AND end_time IS NULL)
        OR (kind = 'open' AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
      )
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_date_overrides_venue_date ON venue.date_overrides(venue_id, date)`.simple();
  console.log("  ✓ venue.date_overrides table");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.shift_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id UUID NOT NULL REFERENCES venue.venues(id) ON DELETE CASCADE,
      weekday INT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      title TEXT NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      min_people INT NOT NULL DEFAULT 1 CHECK (min_people >= 0),
      max_people INT CHECK (max_people IS NULL OR max_people >= min_people),
      require_target_for_opening BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (start_time < end_time)
    )
  `.simple();
  await sql`
    ALTER TABLE IF EXISTS venue.shift_templates
    ADD COLUMN IF NOT EXISTS require_target_for_opening BOOLEAN NOT NULL DEFAULT false
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_shift_templates_venue_weekday ON venue.shift_templates(venue_id, weekday, start_time)`.simple();
  console.log("  ✓ venue.shift_templates table");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.shift_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id UUID NOT NULL REFERENCES venue.venues(id) ON DELETE CASCADE,
      template_id UUID REFERENCES venue.shift_templates(id) ON DELETE SET NULL,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (starts_at < ends_at)
    )
  `.simple();
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_shift_assignments_user_slot
    ON venue.shift_assignments(venue_id, user_id, starts_at, ends_at)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_venue_shift_assignments_venue_time
    ON venue.shift_assignments(venue_id, starts_at, ends_at)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_venue_shift_assignments_user_time
    ON venue.shift_assignments(user_id, starts_at)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_venue_shift_assignments_template_start
    ON venue.shift_assignments(template_id, starts_at)
    WHERE template_id IS NOT NULL
  `.simple();
  console.log("  ✓ venue.shift_assignments table");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.public_sections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id UUID NOT NULL REFERENCES venue.venues(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('markdown', 'menu', 'notice', 'links')),
      title TEXT NOT NULL,
      content JSONB NOT NULL DEFAULT '{}'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT true,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_public_sections_venue_position ON venue.public_sections(venue_id, position, created_at)`.simple();
  console.log("  ✓ venue.public_sections table");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.feedback_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id UUID NOT NULL REFERENCES venue.venues(id) ON DELETE CASCADE,
      rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_feedback_venue_created ON venue.feedback_entries(venue_id, created_at DESC)`.simple();
  console.log("  ✓ venue.feedback_entries table");

  await sql`
    CREATE TABLE IF NOT EXISTS venue.user_ical_tokens (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_venue_user_ical_tokens_token ON venue.user_ical_tokens(token)`.simple();
  console.log("  ✓ venue.user_ical_tokens table");
};
