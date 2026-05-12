/**
 * Autocomplete für `=FORMULA(...)` in Markdown-Tabellenzellen.
 *
 * Trigger: cursor is inside a table cell whose typed content so far
 * begins with `=` (optionally followed by an in-progress function
 * name). Accepting a suggestion expands to a full call template
 * with tab-stops for arguments — e.g. `=SUM(${1:Column})` lands
 * the cursor inside the parens with the column-name placeholder
 * already selected for replacement.
 *
 * Functions mirror the registry in
 * `@valentinkolb/cloud/shared/markdown/formula.ts` (the same module
 * that EVALUATES the formulas in both edit-mode preview and
 * read-mode rendering). Keep them in sync when new functions are
 * added there.
 *
 * # Scope detection
 *
 * We don't lean on the Lezer-markdown `Table` / `TableRow` /
 * `TableCell` nodes because they require the table to be
 * structurally complete to be emitted — while the user is actively
 * typing a new row (no separator line yet, or a cell being filled
 * mid-edit) the parser often hasn't promoted the lines to a Table
 * node yet, and the completions wouldn't fire. The structural
 * heuristic is more robust:
 *
 *   1. Current line begins AND ends with `|` after trimming
 *   2. Current line is NOT the separator row (`|---|---|`)
 *   3. The cell the cursor sits in (text between the nearest `|`
 *      before the cursor and the cursor itself) trims to `=<partial>`
 *
 * All three checks are O(line length) — cheap.
 */
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";

type Formula = {
  /** Function name as it appears in the formula source. */
  name: string;
  /** Signature shown inline as the option detail. */
  detail: string;
  /** Snippet body inside the parens. `${1:foo}` are tab-stops the
   *  user can step through after accepting. */
  args: string;
  /** Tabler icon — categorises functions visually. */
  icon: string;
};

/** Registry — keep in sync with `FUNCTIONS` in
 *  `packages/cloud/src/shared/markdown/formula.ts`. */
const FORMULAS: Formula[] = [
  // Math ─────────────────────────────────────────────────────────
  { name: "ROUND", detail: "(number, digits)", args: "${1:value}, ${2:2}", icon: "ti-math-function" },
  { name: "ABS", detail: "(number)", args: "${1:value}", icon: "ti-math-function" },
  // Column aggregates ────────────────────────────────────────────
  { name: "SUM", detail: "(column) — sum of column", args: "${1:Column}", icon: "ti-sum" },
  { name: "AVG", detail: "(column) — average of column", args: "${1:Column}", icon: "ti-math-avg" },
  { name: "MIN", detail: "(column) — minimum of column", args: "${1:Column}", icon: "ti-math-min" },
  { name: "MAX", detail: "(column) — maximum of column", args: "${1:Column}", icon: "ti-math-max" },
  { name: "COUNT", detail: "(column) — non-empty count", args: "${1:Column}", icon: "ti-tallymark-4" },
  { name: "MEDIAN", detail: "(column) — median of column", args: "${1:Column}", icon: "ti-math-avg" },
  // Sugar ────────────────────────────────────────────────────────
  { name: "PERCENT", detail: "(part, total) — rounded percent", args: "${1:part}, ${2:total}", icon: "ti-percentage" },
  // Row aggregates ───────────────────────────────────────────────
  { name: "ROWSUM", detail: "() — sum of other cells in row", args: "", icon: "ti-sum" },
  { name: "ROWAVG", detail: "() — average of other cells in row", args: "", icon: "ti-math-avg" },
  // Conditional ──────────────────────────────────────────────────
  { name: "IF", detail: "(cond, then, else)", args: "${1:condition}, ${2:then}, ${3:else}", icon: "ti-git-branch" },
  { name: "IFEMPTY", detail: "(value, fallback)", args: "${1:value}, ${2:fallback}", icon: "ti-git-branch" },
  { name: "IFERROR", detail: "(value, fallback)", args: "${1:value}, ${2:fallback}", icon: "ti-git-branch" },
  // Text ─────────────────────────────────────────────────────────
  { name: "CONCAT", detail: "(...parts) — join strings", args: "${1:a}, ${2:b}", icon: "ti-typography" },
  { name: "UPPER", detail: "(text) — uppercase", args: "${1:text}", icon: "ti-letter-case-upper" },
  { name: "LOWER", detail: "(text) — lowercase", args: "${1:text}", icon: "ti-letter-case-lower" },
  { name: "LEN", detail: "(text) — character count", args: "${1:text}", icon: "ti-ruler-measure" },
  { name: "SUBSTRING", detail: "(text, start, end?)", args: "${1:text}, ${2:start}, ${3:end}", icon: "ti-cut" },
];

/** Snippet template. Does NOT include the leading `=` because the
 *  `from` position in the CompletionResult is anchored AFTER the
 *  `=` the user already typed — CM's prefix-filter compares the
 *  typed name fragment against `label` ("SUM", "AVG", …), and on
 *  acceptance only the text between `from` and the cursor is
 *  replaced. The user's typed `=` stays in place. The trailing
 *  `${0}` parks the final cursor outside the parens. */
const buildSnippet = (f: Formula): string =>
  f.args.length === 0 ? `${f.name}()` : `${f.name}(${f.args})\${0}`;

const COMPLETIONS: Completion[] = FORMULAS.map((f) => {
  const c = snippetCompletion(buildSnippet(f), {
    label: f.name,
    type: "function",
    detail: f.detail,
  });
  (c as Completion & { kitIcon: string }).kitIcon = f.icon;
  return c;
});

/** Cheap-and-correct check: line is a markdown table data row. We
 *  trim because list-nested or block-quoted tables can have leading
 *  whitespace / `>` markers. Separator rows like `|---|:--:|` are
 *  rejected — they're structural metadata, not data cells, and
 *  shouldn't accept formulas. */
const TABLE_SEPARATOR_RE = /^\s*\|?\s*[:\-|\s]+\|?\s*$/;
const isTableRow = (lineText: string): boolean => {
  const trimmed = lineText.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  // Must have at least one INTERNAL `|` — a single-pipe line like
  // `|` isn't a table row, just a pipe character.
  const pipeCount = (trimmed.match(/\|/g) ?? []).length;
  if (pipeCount < 2) return false;
  if (TABLE_SEPARATOR_RE.test(lineText)) return false;
  return true;
};

/** Find the text typed in the current cell, from the nearest `|`
 *  before the cursor up to the cursor itself. Returns null if no
 *  `|` separator exists on the line before the cursor (which means
 *  the cursor is in the "row prefix" before the table starts, not
 *  in a cell). */
const cellTextBeforeCursor = (lineText: string, cursorCol: number): { from: number; text: string } | null => {
  // cursorCol is the offset within lineText where the cursor sits.
  // We walk backwards from there until we hit a `|`.
  let i = cursorCol - 1;
  while (i >= 0 && lineText[i] !== "|") i--;
  if (i < 0) return null;
  // Cell starts at i+1 (just past the `|`).
  return { from: i + 1, text: lineText.slice(i + 1, cursorCol) };
};

/**
 * Completion source. Wire into `autocompletion({override: […]})`.
 *
 * # Two-stage filter for hot-path performance
 *
 * Per keystroke, MOST users are NOT inside a table cell. Doing
 * `lineAt` + `isTableRow` + `cellTextBeforeCursor` on every
 * keystroke would burn CPU for nothing. We bail early via the
 * cheapest possible check first:
 *
 *   1. `matchBefore(/=\w*\$/)` — the cursor must be on text that
 *      ends with `=<word>`. If not, return null immediately. This
 *      is the same `Line.text.search()` call CM does internally;
 *      sub-millisecond on any sane line length.
 *
 *   2. ONLY THEN do we verify the line is a table row AND the cell
 *      content matches the formula pattern.
 *
 * Without this two-stage filter the source was the dominant
 * per-keystroke cost outside script fences (it always called
 * `lineAt` + ran a regex over the full line, even when typing in
 * a plain paragraph far from any table).
 */
export const tableFormulaCompletionSource = (
  context: CompletionContext,
): CompletionResult | null => {
  // Stage 1 — cheap: must be typing something that ends in `=<word>`.
  const word = context.matchBefore(/=\w*/);
  if (!word) return null;

  // Stage 2 — confirm we're in a table cell.
  const line = context.state.doc.lineAt(context.pos);
  if (!isTableRow(line.text)) return null;

  const cursorCol = context.pos - line.from;
  const cell = cellTextBeforeCursor(line.text, cursorCol);
  if (!cell) return null;

  // Cell content must START with `=` (after optional whitespace).
  // Once the user types `(` or any non-word char, this source
  // stops firing (correct — they're inside an argument list, not
  // picking a function).
  if (!/^\s*=\w*$/.test(cell.text)) return null;

  // Anchor `from` AFTER the `=` so CM's prefix-filter sees just the
  // function-name fragment (e.g. "SU" → "SUM"). Anchoring at the `=`
  // would force the labels to start with `=`, which they don't, so
  // CM would silently drop every option → empty popup.
  return {
    from: word.from + 1,
    to: context.pos,
    options: COMPLETIONS,
    validFor: /^\w*$/,
  };
};
