import { sql } from "bun";

// ==========================
// Schema: notebooks
// ==========================

/**
 * Creates the notebooks schema and all related tables.
 * Safe to run multiple times (uses IF NOT EXISTS).
 *
 * Structure:
 * - notebooks: Container with access control (like wiki/vault)
 * - notes: Hierarchical notes within a notebook (with Yjs CRDT content)
 * - note_versions: Snapshots of notes for version history
 */
export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS notebooks`.simple();
  console.log("  ✓ notebooks schema");

  // ----------------------------------------------------------
  // Notebooks (Container for Notes)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.notebooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,

      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ notebooks.notebooks table");

  // ----------------------------------------------------------
  // Notebook Access (junction table to auth.access)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.notebook_access (
      notebook_id UUID NOT NULL REFERENCES notebooks.notebooks(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (notebook_id, access_id)
    )
  `.simple();
  console.log("  ✓ notebooks.notebook_access table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notebook_access_access
    ON notebooks.notebook_access(access_id)
  `.simple();

  // ----------------------------------------------------------
  // Notes (Hierarchical notes with Yjs CRDT content)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notebook_id UUID NOT NULL REFERENCES notebooks.notebooks(id) ON DELETE CASCADE,
      parent_id UUID REFERENCES notebooks.notes(id) ON DELETE CASCADE,

      title TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,

      -- Current Yjs document snapshot (binary)
      yjs_snapshot BYTEA,
      -- Last applied stream cursor (for multi-node stale-write protection)
      yjs_stream_ms BIGINT,
      yjs_stream_seq BIGINT,
      -- Last time the Yjs snapshot was saved
      yjs_snapshot_at TIMESTAMPTZ,
      -- Markdown export for full-text search
      content_md TEXT,

      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ notebooks.notes table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notes_notebook
    ON notebooks.notes(notebook_id)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notes_parent
    ON notebooks.notes(parent_id)
  `.simple();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notes_notebook_parent_position
    ON notebooks.notes(notebook_id, parent_id, position)
  `.simple();

  // ----------------------------------------------------------
  // Note Versions (Snapshots for version history)
  // ----------------------------------------------------------

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.note_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      note_id UUID NOT NULL REFERENCES notebooks.notes(id) ON DELETE CASCADE,

      -- Yjs snapshot at this version (binary)
      yjs_snapshot BYTEA NOT NULL,
      -- Markdown export at this version
      content_md TEXT,

      -- Optional: Title at this version (for display in history)
      title TEXT,

      -- Who created this version (null = auto-save)
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ notebooks.note_versions table");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_note_versions_note
    ON notebooks.note_versions(note_id, created_at DESC)
  `.simple();

  // ----------------------------------------------------------
  // Migration: Drop unused slug & icon columns from notes
  // ----------------------------------------------------------

  await sql`DROP INDEX IF EXISTS notebooks.idx_notes_unique_slug_with_parent`.simple();
  await sql`DROP INDEX IF EXISTS notebooks.idx_notes_unique_slug_at_root`.simple();
  await sql`ALTER TABLE notebooks.notes DROP COLUMN IF EXISTS slug`.simple();
  await sql`ALTER TABLE notebooks.notes DROP COLUMN IF EXISTS icon`.simple();
  console.log("  ✓ dropped slug & icon from notebooks.notes");

  // ----------------------------------------------------------
  // Migration: Add locked_at column for note locking
  // ----------------------------------------------------------

  await sql`
    ALTER TABLE notebooks.notes
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NULL
  `.simple();
  console.log("  ✓ added locked_at column to notebooks.notes");

  await sql`
    ALTER TABLE notebooks.notes
    ADD COLUMN IF NOT EXISTS yjs_stream_ms BIGINT,
    ADD COLUMN IF NOT EXISTS yjs_stream_seq BIGINT
  `.simple();
  console.log("  ✓ ensured yjs stream cursor columns on notebooks.notes");

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'notebooks'
          AND table_name = 'notes'
          AND column_name = 'yjs_stream_cursor'
      ) THEN
        UPDATE notebooks.notes
        SET yjs_stream_ms = split_part(yjs_stream_cursor, '-', 1)::bigint,
            yjs_stream_seq = split_part(yjs_stream_cursor, '-', 2)::bigint
        WHERE yjs_stream_cursor ~ '^[0-9]+-[0-9]+$'
          AND (yjs_stream_ms IS NULL OR yjs_stream_seq IS NULL);
      END IF;
    END $$;
  `.simple();
  console.log("  ✓ backfilled yjs stream cursor values");

  await sql`ALTER TABLE notebooks.notes DROP COLUMN IF EXISTS yjs_stream_cursor`.simple();
  console.log("  ✓ dropped legacy yjs_stream_cursor column from notebooks.notes");
};
