/**
 * Pure markdown-derived note insights shared by SSR, API route-state loading,
 * and editor/detail islands.
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

export type TaskProgress = {
  done: number;
  total: number;
};

const TASK_LINE_REGEX = /^[ \t]*[-*+]\s+\[([ xX])\]/gm;

export const extractTaskProgress = (md: string | null): TaskProgress => {
  if (!md) return { done: 0, total: 0 };
  let done = 0;
  let total = 0;
  for (const match of md.matchAll(TASK_LINE_REGEX)) {
    total++;
    const marker = match[1];
    if (marker === "x" || marker === "X") done++;
  }
  return { done, total };
};
