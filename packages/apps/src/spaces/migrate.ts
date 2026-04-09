import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.simple();
  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`.simple();

  await sql`CREATE SCHEMA IF NOT EXISTS spaces`.simple();
  console.log("  ✓ spaces schema");

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.spaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#3b82f6',
      ical_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_spaces_ical_token
    ON spaces.spaces(ical_token) WHERE ical_token IS NOT NULL
  `.simple();
  console.log("  ✓ spaces.spaces table");

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.space_access (
      space_id UUID NOT NULL REFERENCES spaces.spaces(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (space_id, access_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_space_access_access
    ON spaces.space_access(access_id)
  `.simple();
  console.log("  ✓ spaces.space_access table");

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.columns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      space_id UUID NOT NULL REFERENCES spaces.spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT,
      position INT NOT NULL DEFAULT 0,
      rank BIGINT NOT NULL DEFAULT 1024,
      is_done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_columns_space_position
    ON spaces.columns(space_id, position)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_columns_space_rank
    ON spaces.columns(space_id, rank)
  `.simple();
  console.log("  ✓ spaces.columns table");

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.tags (
      id UUID DEFAULT gen_random_uuid() CONSTRAINT labels_pkey PRIMARY KEY,
      space_id UUID NOT NULL CONSTRAINT labels_space_id_fkey REFERENCES spaces.spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      CONSTRAINT labels_space_id_name_key UNIQUE (space_id, name)
    )
  `.simple();
  console.log("  ✓ spaces.tags table");

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      space_id UUID NOT NULL REFERENCES spaces.spaces(id) ON DELETE CASCADE,
      column_id UUID NOT NULL REFERENCES spaces.columns(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      description TEXT,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      deadline TIMESTAMPTZ,
      priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      position INT NOT NULL DEFAULT 0,
      rank BIGINT NOT NULL DEFAULT 1024,
      completed_at TIMESTAMPTZ,
      email_thread_id TEXT,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT item_time_range CHECK (
        (starts_at IS NULL AND ends_at IS NULL) OR
        (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
      )
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_items_space
    ON spaces.items(space_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_items_column
    ON spaces.items(column_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_items_space_column_position
    ON spaces.items(space_id, column_id, position)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_items_space_column_rank
    ON spaces.items(space_id, column_id, rank)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_items_column_rank
    ON spaces.items(column_id, rank)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_items_calendar
    ON spaces.items(space_id, starts_at, ends_at)
    WHERE completed_at IS NULL AND (starts_at IS NOT NULL OR deadline IS NOT NULL)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_items_time_range
    ON spaces.items USING GIST (tstzrange(starts_at, ends_at, '[]'))
    WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL AND completed_at IS NULL
  `.simple();
  console.log("  ✓ spaces.items table");

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.item_assignees (
      item_id UUID NOT NULL REFERENCES spaces.items(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, user_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_item_assignees_user
    ON spaces.item_assignees(user_id)
  `.simple();
  console.log("  ✓ spaces.item_assignees table");

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.item_tags (
      item_id UUID NOT NULL CONSTRAINT item_labels_item_id_fkey REFERENCES spaces.items(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL CONSTRAINT item_labels_label_id_fkey REFERENCES spaces.tags(id) ON DELETE CASCADE,
      CONSTRAINT item_labels_pkey PRIMARY KEY (item_id, tag_id)
    )
  `.simple();
  console.log("  ✓ spaces.item_tags table");

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID NOT NULL REFERENCES spaces.items(id) ON DELETE CASCADE,
      user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_comments_item
    ON spaces.comments(item_id, created_at)
  `.simple();
  console.log("  ✓ spaces.comments table");

  await sql`
    CREATE OR REPLACE FUNCTION spaces.check_overlap(
      p_start TIMESTAMPTZ,
      p_end TIMESTAMPTZ,
      p_exclude_item_id UUID DEFAULT NULL
    ) RETURNS TABLE(
      item_id UUID,
      space_id UUID,
      space_name TEXT,
      title TEXT,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT i.id, s.id, s.name, i.title, i.starts_at, i.ends_at
      FROM spaces.items i
      JOIN spaces.spaces s ON i.space_id = s.id
      WHERE
        i.starts_at IS NOT NULL AND i.ends_at IS NOT NULL
        AND i.completed_at IS NULL
        AND tstzrange(i.starts_at, i.ends_at, '[]') && tstzrange(p_start, p_end, '[]')
        AND (p_exclude_item_id IS NULL OR i.id != p_exclude_item_id);
    END;
    $$ LANGUAGE plpgsql STABLE
  `.simple();
  console.log("  ✓ spaces.check_overlap function");
};
