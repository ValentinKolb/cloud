import { sql } from "bun";

export const migrate = async (): Promise<void> => {
  await sql`CREATE SCHEMA IF NOT EXISTS notebooks`.simple();
  console.log("  ✓ notebooks schema");

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

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.notebook_access (
      notebook_id UUID NOT NULL REFERENCES notebooks.notebooks(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (notebook_id, access_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_notebook_access_access
    ON notebooks.notebook_access(access_id)
  `.simple();
  console.log("  ✓ notebooks.notebook_access table");

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notebook_id UUID NOT NULL REFERENCES notebooks.notebooks(id) ON DELETE CASCADE,
      parent_id UUID REFERENCES notebooks.notes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      yjs_snapshot BYTEA,
      yjs_stream_ms BIGINT,
      yjs_stream_seq BIGINT,
      yjs_snapshot_at TIMESTAMPTZ,
      content_md TEXT,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_at TIMESTAMPTZ DEFAULT NULL
    )
  `.simple();
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
  console.log("  ✓ notebooks.notes table");

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.note_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      note_id UUID NOT NULL REFERENCES notebooks.notes(id) ON DELETE CASCADE,
      yjs_snapshot BYTEA NOT NULL,
      content_md TEXT,
      title TEXT,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_note_versions_note
    ON notebooks.note_versions(note_id, created_at DESC)
  `.simple();
  console.log("  ✓ notebooks.note_versions table");

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.note_links (
      source_note_id UUID NOT NULL REFERENCES notebooks.notes(id) ON DELETE CASCADE,
      target_note_id UUID NOT NULL REFERENCES notebooks.notes(id) ON DELETE CASCADE,
      PRIMARY KEY (source_note_id, target_note_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_note_links_target
    ON notebooks.note_links(target_note_id)
  `.simple();
  console.log("  ✓ notebooks.note_links table");

  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notebook_id UUID NOT NULL REFERENCES notebooks.notebooks(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'file')),
      content BYTEA NOT NULL,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_attachments_notebook
    ON notebooks.attachments(notebook_id)
  `.simple();
  console.log("  ✓ notebooks.attachments table");

  // Index table for `#tag` references inside note bodies. Reindexed on
  // every note save (and periodically by the scheduler — see
  // `service/reindex-scheduler.ts`). Notebook id denormalised so
  // notebook-scoped aggregations don't need a JOIN through `notes`.
  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.note_tags (
      note_id     UUID NOT NULL REFERENCES notebooks.notes(id) ON DELETE CASCADE,
      notebook_id UUID NOT NULL REFERENCES notebooks.notebooks(id) ON DELETE CASCADE,
      tag         TEXT NOT NULL,
      PRIMARY KEY (note_id, tag)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_note_tags_nb_tag
    ON notebooks.note_tags(notebook_id, tag)
  `.simple();
  // text_pattern_ops makes prefix LIKE 'pre%' fast (byte compare instead
  // of locale collation) — used by tag-picker autocomplete.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_note_tags_nb_prefix
    ON notebooks.note_tags(notebook_id, tag text_pattern_ops)
  `.simple();
  console.log("  ✓ notebooks.note_tags table");

  // Index table for `attachment://<id>` references inside note bodies.
  // Replaces the previous `LIKE '%attachment://...'` scan in
  // `attachment.usageCount` with an O(log N) lookup.
  await sql`
    CREATE TABLE IF NOT EXISTS notebooks.note_attachments (
      note_id       UUID NOT NULL REFERENCES notebooks.notes(id) ON DELETE CASCADE,
      notebook_id   UUID NOT NULL REFERENCES notebooks.notebooks(id) ON DELETE CASCADE,
      attachment_id UUID NOT NULL REFERENCES notebooks.attachments(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, attachment_id)
    )
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_note_attachments_attachment
    ON notebooks.note_attachments(attachment_id)
  `.simple();
  await sql`
    CREATE INDEX IF NOT EXISTS idx_note_attachments_nb
    ON notebooks.note_attachments(notebook_id, attachment_id)
  `.simple();
  console.log("  ✓ notebooks.note_attachments table");
};
