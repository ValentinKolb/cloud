/**
 * Markdown-only: detect whether a position in the text falls inside
 * an inline-code span (between backticks) or a fenced code block
 * (between triple-backtick lines).
 *
 * Used by the MarkdownEditor to suppress completions and
 * auto-expansion inside code regions — code content is supposed to
 * be verbatim. Lives here (and not in the generic completion engine)
 * because the rule is markdown-specific.
 */
export const isInCodeZone = (text: string, pos: number): boolean => {
  const before = text.slice(0, pos);

  // Fenced code block: count "```" at line starts. Odd count → open.
  const fenceMatches = before.match(/^```/gm);
  if (fenceMatches && fenceMatches.length % 2 !== 0) return true;

  // Inline code: odd number of `` ` `` on the current line before pos.
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineBefore = before.slice(lineStart);
  const tickCount = (lineBefore.match(/`/g) || []).length;
  return tickCount % 2 !== 0;
};
