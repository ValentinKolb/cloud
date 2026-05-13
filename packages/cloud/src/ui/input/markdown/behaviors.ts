/**
 * Editor input behaviours — pure event handlers that translate user
 * gestures (keystrokes, paste) into the textarea-manipulation actions
 * defined in `actions.ts`. None of these own state of their own; each
 * is a small function the host component wires into the matching DOM
 * event.
 *
 * Conventions:
 *
 *   - Each handler returns `true` when it has consumed the event;
 *     the caller should then `preventDefault()` and stop further
 *     processing. `false` means "I'm not interested — fall through to
 *     the next handler or to the browser default".
 *   - All mutations go through `actions.ts` or `execCommand("insertText")`
 *     so the textarea's native undo history stays usable. We never
 *     assign `textarea.value` directly.
 */
import {
  toggleBold,
  toggleItalic,
  toggleCode,
  toggleBulletList,
  toggleNumberedList,
  toggleHeading,
  insertLink,
} from "./actions";

/* ────────────────────────────────────────────────────────────────────
 * Keyboard shortcuts
 * ──────────────────────────────────────────────────────────────────── */

const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

/**
 * Cmd/Ctrl + (B/I/E/K) + (Shift+1/2/3 for headings, Shift+7/8 for
 * lists). Mac-aware (metaKey vs ctrlKey). Skips firing during IME
 * composition (overtype issue #80 lesson). Layout-independent digit
 * detection via `e.code === "DigitN"` so Shift+1 works on QWERTY,
 * AZERTY, German, etc.
 */
export const handleShortcut = (e: KeyboardEvent, ta: HTMLTextAreaElement): boolean => {
  if (e.isComposing) return false;
  // AltGr on Windows / Linux raises `altKey + ctrlKey` together to
  // produce keys like `@`. Skip Ctrl-shortcuts when Alt is held so we
  // don't hijack AltGr character entry.
  if (e.altKey) return false;
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (!mod) return false;

  if (!e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case "b":
        toggleBold(ta);
        return true;
      case "i":
        toggleItalic(ta);
        return true;
      case "e":
        // GitHub / Slack / Notion convention for inline code.
        toggleCode(ta);
        return true;
      case "k":
        insertLink(ta);
        return true;
    }
  }

  if (e.shiftKey) {
    // We check `e.code` (layout-independent physical key) rather than
    // `e.key` (the produced character), so US Shift+1 (`!`),
    // German Shift+1 (`!`), and AZERTY Shift+1 (`1`) all map to H1.
    switch (e.code) {
      case "Digit1":
        toggleHeading(ta, 1);
        return true;
      case "Digit2":
        toggleHeading(ta, 2);
        return true;
      case "Digit3":
        toggleHeading(ta, 3);
        return true;
      case "Digit7":
        toggleNumberedList(ta);
        return true;
      case "Digit8":
        toggleBulletList(ta);
        return true;
    }
  }

  return false;
};

/* ────────────────────────────────────────────────────────────────────
 * Smart list continuation on Enter
 * ──────────────────────────────────────────────────────────────────── */

// `(\s*)` indent, marker (`-`, `*`, `+`, or `N.`), required whitespace,
// then the rest of the line content.
const LIST_RE = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/;

const insertViaExecCommand = (ta: HTMLTextAreaElement, start: number, end: number, replacement: string): void => {
  ta.focus();
  ta.setSelectionRange(start, end);
  document.execCommand("insertText", false, replacement);
};

/**
 * Enter inside a list item:
 *   - Non-empty item + caret at-or-after the marker → insert a new
 *     line with the same indent + marker (numbered lists bump by 1).
 *   - Empty item (marker only) → strip the marker, exit the list.
 *   - Caret BEFORE the marker (e.g. column 0) → defer to native Enter
 *     so we don't produce `\n- - item` nonsense.
 */
export const handleListContinuation = (ta: HTMLTextAreaElement): boolean => {
  const value = ta.value;
  const caret = ta.selectionStart;
  if (caret !== ta.selectionEnd) return false; // selection → defer to native

  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const nextNl = value.indexOf("\n", caret);
  const lineEnd = nextNl === -1 ? value.length : nextNl;
  const line = value.slice(lineStart, lineEnd);

  const m = LIST_RE.exec(line);
  if (!m) return false;

  const [, indent, marker, spaces, content] = m;
  const markerEndPos = lineStart + indent!.length + marker!.length + spaces!.length;

  // Caret must be at or past the marker. Editing the indent itself
  // (caret < markerEndPos) gets native Enter.
  if (caret < markerEndPos) return false;

  // Empty item → exit the list by clearing this line.
  if (content!.trim() === "") {
    insertViaExecCommand(ta, lineStart, lineEnd, "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // Non-empty item → continue with same indent + (renumbered) marker.
  const numbered = /^(\d+)\.$/.exec(marker!);
  const nextMarker = numbered ? `${parseInt(numbered[1]!, 10) + 1}.` : marker!;
  const insert = `\n${indent}${nextMarker}${spaces}`;
  insertViaExecCommand(ta, caret, caret, insert);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
};

/* ────────────────────────────────────────────────────────────────────
 * Smart paste — URL on selection becomes a markdown link
 * ──────────────────────────────────────────────────────────────────── */

const URL_RE = /^https?:\/\/\S+$/;

/** Markdown link destinations end at the first unescaped `)`. URLs in
 *  the wild often contain literal parens (Wikipedia disambiguation
 *  pages, Microsoft Docs, etc.). Percent-encode them before insertion
 *  so the rendered link syntax stays unambiguous. */
const escapeUrlForMarkdown = (url: string): string => url.replace(/\(/g, "%28").replace(/\)/g, "%29");

/** Reject strings that the loose regex accepts but `new URL()` can't
 *  parse (typos, mismatched-paren pastes, etc.). */
const isValidUrl = (raw: string): boolean => {
  try {
    new URL(raw);
    return true;
  } catch {
    return false;
  }
};

/**
 * If the clipboard contains a single URL AND there's a non-empty
 * selection, replace the selection with `[selection](escapedUrl)`.
 * Otherwise, defer to the browser's native paste.
 */
export const handleSmartPaste = (e: ClipboardEvent, ta: HTMLTextAreaElement): boolean => {
  const clip = e.clipboardData;
  if (!clip) return false;

  const text = clip.getData("text/plain");
  if (!text) return false;
  const trimmed = text.trim();
  if (!URL_RE.test(trimmed)) return false;
  if (!isValidUrl(trimmed)) return false;
  if (ta.selectionStart === ta.selectionEnd) return false;

  insertLink(ta, escapeUrlForMarkdown(trimmed));
  return true;
};
