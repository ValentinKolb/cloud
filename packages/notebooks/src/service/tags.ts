/**
 * Inline `#tag` extraction + index management.
 *
 * Tags live in the markdown body — `#topic`, `#project/notebooks`, etc.
 * They're indexed into `notebooks.note_tags` on every note save so
 * notebook-wide aggregations (tag-overview, autocomplete, search) stay
 * O(log N) instead of full content_md scans.
 *
 * Disambiguation from markdown headings: `# Title` (with space after `#`)
 * is a heading; `#tag` (no space, must start with a letter) is a tag.
 */
import { sql } from "bun";

/** `(?:^|\s)` ensures we only match `#tag` at line-start or after whitespace,
 *  never inside a word. The `[a-zA-Z]` first-char rule excludes numerals
 *  (`#1` is not a tag) and `#` repetition (`##` headings). Nesting via `/`. */
const TAG_REGEX = /(?:^|\s)#([a-zA-Z][\w-]*(?:\/[\w-]+)*)/g;

/** Strip fenced + inline code so we don't extract tags from documentation
 *  about the tag syntax or from `#define` C macros etc. inside code blocks. */
const stripCodeBlocks = (md: string): string =>
  md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");

/** Extract every unique tag (lowercased) referenced from a markdown body. */
export const extractTags = (md: string | null): string[] => {
  if (!md) return [];
  const stripped = stripCodeBlocks(md);
  const tags = new Set<string>();
  for (const m of stripped.matchAll(TAG_REGEX)) tags.add(m[1]!.toLowerCase());
  return Array.from(tags);
};

/**
 * Replace the index rows for one note. Single transaction — a partial
 * apply would leave the index in an inconsistent state and is worse than
 * leaving the previous (slightly stale) state intact.
 */
export const reindexTags = async (params: { noteId: string; notebookId: string; contentMd: string | null }): Promise<void> => {
  const tags = extractTags(params.contentMd);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM notebooks.note_tags WHERE note_id = ${params.noteId}`;
    if (tags.length === 0) return;
    const rows = tags.map((tag) => [params.noteId, params.notebookId, tag] as const);
    await tx`
      INSERT INTO notebooks.note_tags ${tx(rows.map(([note_id, notebook_id, tag]) => ({ note_id, notebook_id, tag })))}
      ON CONFLICT DO NOTHING
    `;
  });
};

export type TagSummary = {
  tag: string;
  count: number;
};

/** All tags in a notebook with their note-count. Drives the tag-overview
 *  page and the `/tag` slash-command picker. */
export const listForNotebook = async (params: { notebookId: string }): Promise<TagSummary[]> => {
  const rows = await sql<{ tag: string; count: number }[]>`
    SELECT tag, COUNT(*)::int AS count
    FROM notebooks.note_tags
    WHERE notebook_id = ${params.notebookId}
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `;
  return rows;
};

/** Total distinct tags in a notebook — gates the sidebar "Tags" link. */
export const count = async (params: { notebookId: string }): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(DISTINCT tag)::int AS count
    FROM notebooks.note_tags
    WHERE notebook_id = ${params.notebookId}
  `;
  return row?.count ?? 0;
};
