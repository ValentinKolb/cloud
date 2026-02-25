import { sql } from "bun";

// ==========================
// Schema: spaces
// ==========================

/**
 * Creates the spaces schema and all related tables.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export const migrate = async (): Promise<void> => {
  // Enable pgcrypto extension for gen_random_bytes
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.simple();

  await sql`CREATE SCHEMA IF NOT EXISTS spaces`.simple();
  console.log("  ✓ spaces schema");

  // ----------------------------------------------------------
  // Spaces (Container for Items)
  // ----------------------------------------------------------

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
  console.log("  ✓ spaces.spaces table");

  // ----------------------------------------------------------
  // Space Access (junction table to auth.access)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.space_access (
      space_id UUID NOT NULL REFERENCES spaces.spaces(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (space_id, access_id)
    )
  `.simple();
  console.log("  ✓ spaces.space_access table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_space_access_access
    ON spaces.space_access(access_id)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_spaces_ical_token
    ON spaces.spaces(ical_token) WHERE ical_token IS NOT NULL
  `.simple();

  // ----------------------------------------------------------
  // Columns (Kanban columns per Space)
  // ----------------------------------------------------------

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
  console.log("  ✓ spaces.columns table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_columns_space_position
    ON spaces.columns(space_id, position)
  `.simple();


  // ----------------------------------------------------------
  // Tags (per Space)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.labels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      space_id UUID NOT NULL REFERENCES spaces.spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      UNIQUE (space_id, name)
    )
  `.simple();
  console.log("  ✓ spaces.tags table");

  // ----------------------------------------------------------
  // Items (Unified: Events, Todos, Tickets)
  // ----------------------------------------------------------

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
  console.log("  ✓ spaces.items table");

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


  // ----------------------------------------------------------
  // Rank migration (idempotent)
  // ----------------------------------------------------------

  await sql`
    ALTER TABLE spaces.columns
    ADD COLUMN IF NOT EXISTS rank BIGINT
  `.simple();

  await sql`
    ALTER TABLE spaces.items
    ADD COLUMN IF NOT EXISTS rank BIGINT
  `.simple();

  await sql`
    WITH ordered AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY space_id ORDER BY position, created_at, id) AS rn
      FROM spaces.columns
      WHERE rank IS NULL
    )
    UPDATE spaces.columns c
    SET rank = ordered.rn * 1024
    FROM ordered
    WHERE c.id = ordered.id
  `.simple();

  await sql`
    WITH ordered AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY column_id ORDER BY position, created_at, id) AS rn
      FROM spaces.items
      WHERE rank IS NULL
    )
    UPDATE spaces.items i
    SET rank = ordered.rn * 1024
    FROM ordered
    WHERE i.id = ordered.id
  `.simple();

  await sql`
    ALTER TABLE spaces.columns
    ALTER COLUMN rank SET DEFAULT 1024
  `.simple();

  await sql`
    ALTER TABLE spaces.items
    ALTER COLUMN rank SET DEFAULT 1024
  `.simple();

  await sql`
    ALTER TABLE spaces.columns
    ALTER COLUMN rank SET NOT NULL
  `.simple();

  await sql`
    ALTER TABLE spaces.items
    ALTER COLUMN rank SET NOT NULL
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_columns_space_rank
    ON spaces.columns(space_id, rank)
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

  // GiST index for time range overlap queries
  // Note: btree_gist extension may need to be enabled for this
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`.simple();
    await sql`
      CREATE INDEX IF NOT EXISTS idx_items_time_range
      ON spaces.items USING GIST (tstzrange(starts_at, ends_at, '[]'))
      WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL AND completed_at IS NULL
    `.simple();
    console.log("  ✓ GiST time range index");
  } catch (e) {
    console.log("  ⚠ Could not create GiST index (btree_gist extension may not be available)");
  }

  // ----------------------------------------------------------
  // Item Assignees (n:m)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.item_assignees (
      item_id UUID NOT NULL REFERENCES spaces.items(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, user_id)
    )
  `.simple();
  console.log("  ✓ spaces.item_assignees table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_item_assignees_user
    ON spaces.item_assignees(user_id)
  `.simple();

  // ----------------------------------------------------------
  // Item Tags (n:m)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS spaces.item_labels (
      item_id UUID NOT NULL REFERENCES spaces.items(id) ON DELETE CASCADE,
      label_id UUID NOT NULL REFERENCES spaces.labels(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, label_id)
    )
  `.simple();
  console.log("  ✓ spaces.item_tags table");

  // ----------------------------------------------------------
  // Comments
  // ----------------------------------------------------------

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
  console.log("  ✓ spaces.comments table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_comments_item
    ON spaces.comments(item_id, created_at)
  `.simple();

  // ----------------------------------------------------------
  // Rename: labels → tags (migration for existing DBs, idempotent)
  // ----------------------------------------------------------

  // Only rename if old name still exists and new name doesn't
  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'spaces' AND table_name = 'item_labels')
         AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'spaces' AND table_name = 'item_tags')
      THEN
        ALTER TABLE spaces.item_labels RENAME TO item_tags;
      END IF;
    END $$
  `.simple();
  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'spaces' AND table_name = 'item_tags' AND column_name = 'label_id')
      THEN
        ALTER TABLE spaces.item_tags RENAME COLUMN label_id TO tag_id;
      END IF;
    END $$
  `.simple();
  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'spaces' AND table_name = 'labels')
         AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'spaces' AND table_name = 'tags')
      THEN
        ALTER TABLE spaces.labels RENAME TO tags;
      END IF;
    END $$
  `.simple();
  console.log("  ✓ labels → tags rename");

  // ----------------------------------------------------------
  // PostgreSQL Function for Overlap Check
  // ----------------------------------------------------------

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
