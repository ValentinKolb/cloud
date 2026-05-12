/**
 * Smart-paste handler: if the clipboard contains a single URL AND the
 * user has a non-empty selection, replace the selection with a markdown
 * link `[selection](url)`. Otherwise, let the native paste happen.
 *
 * Why URL-only and strict format (`^https?://\S+$`):
 *   - Avoids hijacking pastes of multi-line text that happens to start
 *     with a URL.
 *   - Whitespace inside breaks the heuristic — a paragraph with a URL
 *     in the middle stays a paragraph.
 *
 * Returns `true` when we've handled the paste (caller must
 * `preventDefault`); `false` to let the browser proceed.
 */
import { insertLink } from "./actions";

const URL_RE = /^https?:\/\/\S+$/;

export const handleSmartPaste = (e: ClipboardEvent, ta: HTMLTextAreaElement): boolean => {
  const clip = e.clipboardData;
  if (!clip) return false;

  const text = clip.getData("text/plain");
  if (!text) return false;
  const trimmed = text.trim();
  if (!URL_RE.test(trimmed)) return false;

  if (ta.selectionStart === ta.selectionEnd) return false; // no selection → normal paste

  insertLink(ta, trimmed);
  return true;
};
