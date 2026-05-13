/**
 * Inspect the textarea's current line and cursor position, return the
 * set of markdown formats currently "active" at the caret. The toolbar
 * uses this to highlight matching buttons (overtype convention: blue
 * tint on the icon when the cursor sits inside a styled span).
 *
 * Format IDs match the toolbar button IDs: `bold`, `italic`, `code`,
 * `h1`, `h2`, `h3`, `bullet`, `ordered`, `quote`.
 *
 * Inline detection is heuristic — we count delimiter occurrences on
 * the current line up to the caret. An odd count means we're "inside"
 * that delimiter. This works for typical markdown but won't catch
 * every CommonMark edge case (escaped asterisks, intra-word
 * underscores, etc.). Good enough for live UI feedback.
 */
/** True if the caret on this line sits inside an unclosed inline-code
 *  span (odd number of backticks before it). */
const inOpenCode = (beforeOnLine: string): boolean => (beforeOnLine.match(/`/g) ?? []).length % 2 !== 0;

/** True if the caret sits between `](` and `)` of a markdown link, i.e.
 *  inside the URL parens. We don't want to report bold/italic/code as
 *  active while editing a URL. */
const inLinkUrl = (beforeOnLine: string): boolean => {
  // Scan from right-to-left for the first unbalanced "](" with no `)`
  // between it and the caret.
  const lastUrlOpen = beforeOnLine.lastIndexOf("](");
  if (lastUrlOpen === -1) return false;
  const afterOpen = beforeOnLine.slice(lastUrlOpen + 2);
  return !afterOpen.includes(")");
};

/** Replace ranges between paired delimiters with spaces of equal length
 *  so the remaining string preserves character offsets but no longer
 *  contains "active" delimiter chars. Used to neutralise inline code
 *  spans and link URLs before counting bold/italic delimiters. */
const scrub = (s: string): string =>
  s
    // Inline code: closed spans (paired backtick runs)
    .replace(/(?<!`)(`+)(?!`)([^\n]+?)\1(?!`)/g, (m) => " ".repeat(m.length))
    // Link URL section `](…)` — keep `[label` intact so its asterisks
    // are still counted; only the URL is scrubbed.
    .replace(/\]\(([^)\n]*?)\)/g, (m) => " ".repeat(m.length));

export const computeActiveFormats = (textarea: HTMLTextAreaElement): Set<string> => {
  const value = textarea.value;
  const caret = textarea.selectionStart;
  const active = new Set<string>();

  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const nextNl = value.indexOf("\n", caret);
  const lineEnd = nextNl === -1 ? value.length : nextNl;
  const line = value.slice(lineStart, lineEnd);
  const beforeOnLine = value.slice(lineStart, caret);

  // Line-level — at most one block format per line.
  const header = /^(#{1,3})\s/.exec(line);
  if (header) active.add(`h${header[1]!.length}`);
  else if (/^\s*[-*+]\s/.test(line)) active.add("bullet");
  else if (/^\s*\d+\.\s/.test(line)) active.add("ordered");
  else if (/^>\s/.test(line)) active.add("quote");

  // Caret inside an OPEN inline-code span — only "code" is meaningful;
  // everything else inside code is verbatim text, not active markdown.
  if (inOpenCode(beforeOnLine)) {
    active.add("code");
    return active;
  }
  // Caret inside a link URL — nothing inline is "active". The user is
  // editing the URL, not styled prose.
  if (inLinkUrl(beforeOnLine)) return active;

  // Scrub closed code spans + link URLs so we don't count their inner
  // asterisks/underscores as styling delimiters on this line.
  const scrubbed = scrub(beforeOnLine);

  // Bold (`**`): count occurrences; strip then count single asterisks
  // for italic, so `**bold**` doesn't double-count its inner stars.
  const boldPairs = (scrubbed.match(/\*\*/g) ?? []).length;
  if (boldPairs % 2 !== 0) active.add("bold");

  const scrubbedNoBold = scrubbed.replace(/\*\*/g, "");
  const italicStars = (scrubbedNoBold.match(/\*/g) ?? []).length;
  if (italicStars % 2 !== 0) active.add("italic");

  // Underscore-bold (`__`) and underscore-italic (`_…_`). Mirror the
  // highlighter so the toolbar reports active state for both delimiter
  // styles. We strip `__` first to disambiguate single vs double, same
  // as the asterisk branch.
  if ((scrubbed.match(/__/g) ?? []).length % 2 !== 0) active.add("bold");
  const scrubbedNoDouble = scrubbed.replace(/__/g, "");
  if ((scrubbedNoDouble.match(/_/g) ?? []).length % 2 !== 0) active.add("italic");

  return active;
};
