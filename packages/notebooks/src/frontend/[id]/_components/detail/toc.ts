/**
 * Table-of-contents extraction from markdown source.
 *
 * The same item list drives:
 *  - SSR rendering of the Outline section in the detail panel
 *  - Heading-id injection into the rendered HTML so anchor scroll works
 *
 * Live (edit-mode) updates are handled by a small island that re-extracts
 * from the CodeMirror doc on changes — same function, same shape.
 */

export type TocItem = {
  level: number;
  text: string;
  id: string;
};

const slugify = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);

const HEADING_LINE_REGEX = /^(#{1,6})\s+(.+?)\s*$/;
const INLINE_MARKUP_REGEX = /[*_`~]/g;

/** Pull headings out of a markdown body, deduping ids when titles collide. */
export const extractTocFromMarkdown = (md: string | null): TocItem[] => {
  if (!md) return [];
  const items: TocItem[] = [];
  const seen = new Map<string, number>();
  for (const line of md.split("\n")) {
    const match = line.match(HEADING_LINE_REGEX);
    if (!match) continue;
    const text = match[2]!.replace(INLINE_MARKUP_REGEX, "");
    const baseSlug = slugify(text) || "section";
    const n = seen.get(baseSlug) ?? 0;
    seen.set(baseSlug, n + 1);
    const id = n === 0 ? baseSlug : `${baseSlug}-${n}`;
    items.push({ level: match[1]!.length, text, id });
  }
  return items;
};

/**
 * Injects sequential `id` attributes onto the rendered HTML's heading tags
 * so `<a href="#slug">` anchors scroll to the right place. Matches headings
 * by document order, not by content — the marked renderer doesn't reorder.
 */
export const injectHeadingIds = (html: string, items: TocItem[]): string => {
  if (items.length === 0) return html;
  let i = 0;
  return html.replace(/<h([1-6])(\s[^>]*)?>/g, (full, level, attrs) => {
    if (i >= items.length) return full;
    const item = items[i++]!;
    if (item.level !== Number(level)) return full;
    return `<h${level} id="${item.id}"${attrs ?? ""}>`;
  });
};
