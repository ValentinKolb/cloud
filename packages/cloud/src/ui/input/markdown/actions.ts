/**
 * Text manipulations for the markdown editor toolbar / shortcuts.
 *
 * Every action operates on a real `<textarea>` element and uses
 * `document.execCommand("insertText", …)` for the actual replacement.
 * Although `execCommand` is technically deprecated, it remains the only
 * way to mutate a textarea while keeping the browser's NATIVE undo
 * stack intact — replacing `.value` directly clears the user's undo
 * history, which is hostile to non-technical users editing prose. All
 * actions are otherwise pure DOM ops with no Solid involvement, so they
 * can be called from event handlers in any framework.
 *
 * Selection handling principles:
 *   - Read `selectionStart` / `selectionEnd` to capture state.
 *   - Compute the replacement string.
 *   - `textarea.setSelectionRange(start, end)` to widen the selection
 *     to cover what we want to replace.
 *   - `document.execCommand("insertText", false, replacement)`.
 *   - Set the cursor / selection to the desired final position.
 *   - Dispatch an `input` event so the host component re-renders the
 *     preview and notifies its `onInput` listener.
 */

const dispatchInput = (ta: HTMLTextAreaElement): void => {
  ta.dispatchEvent(new Event("input", { bubbles: true }));
};

const replaceRange = (ta: HTMLTextAreaElement, start: number, end: number, replacement: string): void => {
  ta.focus();
  ta.setSelectionRange(start, end);
  // Modern: use Input Events API if available. Fall back to execCommand.
  const ok = document.execCommand("insertText", false, replacement);
  if (!ok) {
    // execCommand returned false — paste-fallback: set value directly.
    // Undo will be broken in this path but the edit still lands.
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    ta.value = before + replacement + after;
    const caret = start + replacement.length;
    ta.setSelectionRange(caret, caret);
  }
};

type LineInfo = { lineStart: number; lineEnd: number; line: string };

const lineAt = (value: string, pos: number): LineInfo => {
  const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
  const nlAfter = value.indexOf("\n", pos);
  const lineEnd = nlAfter === -1 ? value.length : nlAfter;
  return { lineStart, lineEnd, line: value.slice(lineStart, lineEnd) };
};

/** Expand the selection to cover full lines for line-level toggles. */
const selectedLineRange = (ta: HTMLTextAreaElement): { start: number; end: number; lines: string[] } => {
  const value = ta.value;
  const selStart = ta.selectionStart;
  const selEnd = ta.selectionEnd;
  const startLine = lineAt(value, selStart);
  // If selEnd is exactly at a line start (just after \n), don't expand
  // forward to the next line — selecting "line1\n" then toggling should
  // affect only line1.
  const adjustedEnd = selEnd > selStart && selEnd > 0 && value[selEnd - 1] === "\n" ? selEnd - 1 : selEnd;
  const endLine = lineAt(value, adjustedEnd);
  const block = value.slice(startLine.lineStart, endLine.lineEnd);
  return { start: startLine.lineStart, end: endLine.lineEnd, lines: block.split("\n") };
};

/* ────────────────────────────────────────────────────────────────────
 * Inline wrappers (bold / italic / code)
 * ──────────────────────────────────────────────────────────────────── */

const toggleInlineWrap = (ta: HTMLTextAreaElement, marker: string, placeholder: string): void => {
  const value = ta.value;
  const selStart = ta.selectionStart;
  const selEnd = ta.selectionEnd;
  const mlen = marker.length;

  // Already wrapped? Check chars just outside the selection.
  const outsideBefore = value.slice(Math.max(0, selStart - mlen), selStart);
  const outsideAfter = value.slice(selEnd, selEnd + mlen);
  if (outsideBefore === marker && outsideAfter === marker) {
    // Unwrap: remove the marker on each side
    replaceRange(ta, selStart - mlen, selEnd + mlen, value.slice(selStart, selEnd));
    const newStart = selStart - mlen;
    const newEnd = selEnd - mlen;
    ta.setSelectionRange(newStart, newEnd);
    dispatchInput(ta);
    return;
  }

  // Or inside-wrapped: selection contains the markers (e.g. user
  // selected `**bold**` itself). Strip if the selection starts and
  // ends with the marker.
  const sel = value.slice(selStart, selEnd);
  if (sel.length >= mlen * 2 && sel.startsWith(marker) && sel.endsWith(marker)) {
    const stripped = sel.slice(mlen, sel.length - mlen);
    replaceRange(ta, selStart, selEnd, stripped);
    ta.setSelectionRange(selStart, selStart + stripped.length);
    dispatchInput(ta);
    return;
  }

  // Wrap. If the selection is empty, insert `marker + placeholder +
  // marker` and select the placeholder so the user can type to replace.
  if (selStart === selEnd) {
    const insert = `${marker}${placeholder}${marker}`;
    replaceRange(ta, selStart, selEnd, insert);
    ta.setSelectionRange(selStart + mlen, selStart + mlen + placeholder.length);
  } else {
    const wrapped = `${marker}${sel}${marker}`;
    replaceRange(ta, selStart, selEnd, wrapped);
    ta.setSelectionRange(selStart + mlen, selStart + mlen + sel.length);
  }
  dispatchInput(ta);
};

export const toggleBold = (ta: HTMLTextAreaElement): void => toggleInlineWrap(ta, "**", "bold text");
export const toggleItalic = (ta: HTMLTextAreaElement): void => toggleInlineWrap(ta, "*", "italic text");
export const toggleCode = (ta: HTMLTextAreaElement): void => toggleInlineWrap(ta, "`", "code");

/* ────────────────────────────────────────────────────────────────────
 * Links
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Insert `[selection](url)` — or `[label](url)` when nothing's selected.
 * After insertion the cursor lands inside the URL parens so the user
 * can immediately paste / type the destination.
 */
export const insertLink = (ta: HTMLTextAreaElement, url?: string): void => {
  const value = ta.value;
  const selStart = ta.selectionStart;
  const selEnd = ta.selectionEnd;
  const sel = value.slice(selStart, selEnd);
  const label = sel || "link";
  const finalUrl = url ?? "";
  const insert = `[${label}](${finalUrl})`;
  replaceRange(ta, selStart, selEnd, insert);
  // Land the cursor inside the parens — between `(` and `)`.
  const caret = selStart + label.length + 3 + finalUrl.length;
  if (finalUrl) {
    // URL was provided (e.g. from smart paste). Select the label so
    // the user can keep typing if they want to rename it.
    ta.setSelectionRange(selStart + 1, selStart + 1 + label.length);
  } else {
    ta.setSelectionRange(caret, caret);
  }
  dispatchInput(ta);
};

/* ────────────────────────────────────────────────────────────────────
 * Line-level toggles (headers, lists, quote)
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Toggle a single-prefix line marker (`> `, `# `, etc.).
 *  - If every selected line starts with `prefix`, strip it from all.
 *  - Otherwise, prepend `prefix` to every selected line.
 */
const togglePrefix = (ta: HTMLTextAreaElement, prefix: string): void => {
  const { start, end, lines } = selectedLineRange(ta);
  const allHave = lines.every((l) => l.startsWith(prefix));
  const transformed = allHave ? lines.map((l) => l.slice(prefix.length)) : lines.map((l) => prefix + l);
  const replacement = transformed.join("\n");
  replaceRange(ta, start, end, replacement);
  ta.setSelectionRange(start, start + replacement.length);
  dispatchInput(ta);
};

/**
 * Toggle a heading at the current line. `level` is 1, 2, or 3. If the
 * line already has the exact level, strip it (toggle off). If it has a
 * different heading level, replace it. Else prepend.
 */
export const toggleHeading = (ta: HTMLTextAreaElement, level: 1 | 2 | 3): void => {
  const value = ta.value;
  const { lineStart, lineEnd, line } = lineAt(value, ta.selectionStart);
  const want = "#".repeat(level) + " ";
  const headerRe = /^(#{1,6})\s/;
  const existing = headerRe.exec(line);
  let newLine: string;
  if (existing && existing[1]!.length === level) {
    newLine = line.slice(existing[0].length);
  } else if (existing) {
    newLine = want + line.slice(existing[0].length);
  } else {
    newLine = want + line;
  }
  replaceRange(ta, lineStart, lineEnd, newLine);
  const delta = newLine.length - line.length;
  const newCaret = ta.selectionStart + delta;
  ta.setSelectionRange(newCaret, newCaret);
  dispatchInput(ta);
};

export const toggleBulletList = (ta: HTMLTextAreaElement): void => togglePrefix(ta, "- ");
export const toggleQuote = (ta: HTMLTextAreaElement): void => togglePrefix(ta, "> ");

/**
 * Numbered list toggle. Renumber from 1 across the selection when adding;
 * strip the `N. ` prefix when removing.
 */
export const toggleNumberedList = (ta: HTMLTextAreaElement): void => {
  const { start, end, lines } = selectedLineRange(ta);
  const numberedRe = /^(\d+)\.\s/;
  const allNumbered = lines.every((l) => numberedRe.test(l));
  let transformed: string[];
  if (allNumbered) {
    transformed = lines.map((l) => l.replace(numberedRe, ""));
  } else {
    transformed = lines.map((l, i) => `${i + 1}. ${l.replace(numberedRe, "")}`);
  }
  const replacement = transformed.join("\n");
  replaceRange(ta, start, end, replacement);
  ta.setSelectionRange(start, start + replacement.length);
  dispatchInput(ta);
};
