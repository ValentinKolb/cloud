/**
 * Browser-side tag extractor — shared between the CodeMirror tag-pill
 * widget, the script-kit (`kit.note.tags`, `kit.notes` post-filter),
 * and any future client extension that needs to know which `#tag`s a
 * markdown body references.
 *
 * Mirrors the canonical regex + code-block-stripping in
 * `service/tags.ts` (server-side index pipeline). Keeping the two
 * deliberately byte-aligned: anything the platform indexes server-
 * side as a tag should also be reported by these utilities, and
 * vice versa. Drift means client-rendered tag pills and server
 * search results disagree — exactly the bug codex flagged on
 * commit 7ee5fdc (kit was using its own narrower regex).
 *
 * Runs entirely on the client — no `bun:sql` or other server-only
 * dependencies. Safe to import from any frontend module.
 */

/**
 * Tag regex.
 *  - `(?:^|\s)` — only at line-start or after whitespace; never
 *    mid-word, never inside `##` (markdown heading).
 *  - First char must be a letter — excludes `#1` (number) and
 *    `##` heading-marker repetition.
 *  - Subsequent chars are word chars / hyphen, with optional `/`-
 *    separated nesting (`#parent/child`).
 */
export const TAG_REGEX = /(?:^|\s)#([a-zA-Z][\w-]*(?:\/[\w-]+)*)/g;

/** Strip fenced + inline code blocks so we don't pick up `#define`
 *  in C samples or `#tag` literals shown in documentation about
 *  the tag syntax. Mirrors `service/tags.ts:stripCodeBlocks`. */
const stripCodeBlocks = (md: string): string =>
  md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");

/** Extract every unique tag (lowercased) referenced from a markdown
 *  body. Returns an empty array for null / empty input. */
export const extractTags = (md: string | null | undefined): string[] => {
  if (!md) return [];
  const stripped = stripCodeBlocks(md);
  const tags = new Set<string>();
  for (const match of stripped.matchAll(TAG_REGEX)) {
    if (match[1]) tags.add(match[1].toLowerCase());
  }
  return [...tags];
};
