/**
 * Smart list continuation on Enter.
 *
 *   - Inside a non-empty list item → insert a new line with the same
 *     indent + marker. Numbered lists auto-increment.
 *   - Inside an empty list item (marker only, no content) → strip the
 *     marker (exit the list).
 *
 * All mutations go through `document.execCommand("insertText")` so the
 * native textarea undo stack remains intact.
 *
 * Returns `true` if the Enter was handled here; caller should
 * `preventDefault()`. Returns `false` to let the native Enter happen.
 */

// `(\s*)` leading indent, then marker (`-`, `*`, `+`, or `N.`), one
// required space, then the rest of the line content.
const LIST_RE = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/;

const replace = (ta: HTMLTextAreaElement, start: number, end: number, replacement: string): void => {
  ta.focus();
  ta.setSelectionRange(start, end);
  document.execCommand("insertText", false, replacement);
};

export const handleListContinuation = (ta: HTMLTextAreaElement): boolean => {
  const value = ta.value;
  const caret = ta.selectionStart;
  if (caret !== ta.selectionEnd) return false; // Selection — defer to native

  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const nextNl = value.indexOf("\n", caret);
  const lineEnd = nextNl === -1 ? value.length : nextNl;
  const line = value.slice(lineStart, lineEnd);

  const m = LIST_RE.exec(line);
  if (!m) return false;

  const [, indent, marker, spaces, content] = m;
  // markerEndPos is the index in `value` just AFTER the marker+spaces.
  const markerEndPos = lineStart + indent!.length + marker!.length + spaces!.length;

  // Empty item: strip the marker, exit the list. Only when the caret
  // sits past the marker (otherwise the user is editing the indent
  // itself and we should let Enter behave natively).
  if (content!.trim() === "" && caret >= markerEndPos) {
    replace(ta, lineStart, lineEnd, "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // Non-empty item: continue with the same indent + (renumbered)
  // marker. For numbered lists, bump by 1. For bullets, repeat the
  // same character so `* foo` ↩ → `* `, `- foo` ↩ → `- `.
  const numbered = /^(\d+)\.$/.exec(marker!);
  const nextMarker = numbered ? `${parseInt(numbered[1]!, 10) + 1}.` : marker!;
  const insert = `\n${indent}${nextMarker}${spaces}`;
  replace(ta, caret, caret, insert);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
};
