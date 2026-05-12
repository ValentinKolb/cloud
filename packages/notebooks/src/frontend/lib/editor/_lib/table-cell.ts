/**
 * Markdown table-row helpers shared by the formula-name autocomplete
 * (`table-formulas.ts`) and the column-name autocomplete
 * (`table-columns.ts`).
 *
 * Both sources need to answer the same two questions per keystroke:
 *
 *   1. Is the current line a table data row? (= begins + ends with
 *      `|`, has at least one internal `|`, isn't a separator row.)
 *   2. What's the text typed inside the current cell?
 *
 * Both checks are intentionally heuristic-only (no Lezer-`Table`
 * node lookup) because the parser doesn't promote a freshly-typed
 * row to a `Table` until the structure is complete; the heuristic
 * works during active editing.
 */

/** Matches the `|---|:--:|` separator row plus permissive variants. */
export const TABLE_SEPARATOR_RE = /^\s*\|?\s*[:\-|\s]+\|?\s*$/;

/** Is this line a markdown table data row?
 *  - begins + ends with `|` (after trim)
 *  - has ≥ 2 pipe characters
 *  - is NOT the `---` separator row
 */
export const isTableRow = (lineText: string): boolean => {
  const trimmed = lineText.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const pipeCount = (trimmed.match(/\|/g) ?? []).length;
  if (pipeCount < 2) return false;
  if (TABLE_SEPARATOR_RE.test(lineText)) return false;
  return true;
};

/** Find the text between the nearest `|` BEFORE the cursor and the
 *  cursor itself. Returns `{ from, text }` with `from` relative to
 *  the line, or `null` if no `|` separator exists before the cursor
 *  (= cursor is in the line's row-prefix before any cell). */
export type CellTextBefore = { from: number; text: string };

export const cellTextBeforeCursor = (lineText: string, cursorCol: number): CellTextBefore | null => {
  let i = cursorCol - 1;
  while (i >= 0 && lineText[i] !== "|") i--;
  if (i < 0) return null;
  return { from: i + 1, text: lineText.slice(i + 1, cursorCol) };
};
