/**
 * Live text-expansion ("AutoText") for the markdown editor.
 *
 * Given a dictionary `{ short: long }`, replaces the word immediately
 * before the cursor with its expansion as soon as the user types a
 * word-boundary character (space, punctuation, newline). Replacements
 * are always verbatim — `MFG` matches `mfg` (case-insensitive lookup
 * for usability) but the output is exactly what's in the dictionary,
 * never re-cased.
 *
 * UX rules baked in here:
 *
 *   - Trigger only on word boundaries: typing `mfg` alone does nothing
 *     until the user types ` `, `,`, `.`, etc. The trigger char itself
 *     is preserved in the expanded text.
 *
 *   - Never expand inside code (inline `` ` `` spans or fenced ```
 *     blocks) — code is supposed to be verbatim.
 *
 *   - Native undo (Cmd/Ctrl+Z) reverts the expansion because we go
 *     through `document.execCommand("insertText", …)`. No special
 *     handling needed.
 *
 *   - Backspace IMMEDIATELY after an expansion restores the original
 *     abbreviation + the trigger char. Once the user types anything
 *     else, the restore window closes.
 *
 *   - Exact dictionary match takes precedence over case-insensitive
 *     fallback, so callers can have both `mfg` → "Mit freundlichen
 *     Grüßen" and `MFG` → "MFG INC." in the same dict and get
 *     deterministic behaviour.
 */

// Characters that terminate a word and (potentially) trigger expansion.
// Whitespace + closing punctuation + sentence-end punctuation. Leaving
// out characters that legitimately appear mid-word (apostrophe, hyphen
// in compound abbreviations).
const TRIGGER_CHARS = new Set([" ", "\t", "\n", ",", ".", "!", "?", ";", ":", ")", "]", "}", '"', "'"]);

// Word characters that can compose an abbreviation. We deliberately go
// beyond plain ASCII so German abbreviations like "schl.U." or "müsst"
// would scan correctly, although in practice abbreviations are usually
// ASCII letters.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

type LastExpansion = {
  textarea: HTMLTextAreaElement;
  startOffset: number;
  originalWord: string;
  triggerChar: string;
  expansion: string;
};

// Module-level state. Acceptable because only one cursor / one
// expansion exists at a time. Module scope keeps the API stateless
// from the caller's view.
let lastExpansion: LastExpansion | null = null;

// When the expansion itself causes another `input` event (because we
// mutate the textarea), the resulting re-entry into `tryExpand` would
// loop if the expansion's tail happens to match another abbreviation.
// We arm a one-shot suppress flag so the immediately-following input
// event is ignored.
let suppressNextExpansion = false;

/**
 * Reset the in-memory state. Call when the editor loses focus or the
 * textarea instance changes — the restore window should not persist
 * across unrelated typing sessions.
 */
export const resetAbbreviationState = (): void => {
  lastExpansion = null;
  suppressNextExpansion = false;
};

/** True if the position `pos` in `text` falls inside an inline-code
 *  span or a fenced code block — abbreviations must not fire there. */
const isInCodeZone = (text: string, pos: number): boolean => {
  const before = text.slice(0, pos);

  // Fenced code block: count "```" at line starts. Odd count → open.
  const fenceMatches = before.match(/^```/gm);
  if (fenceMatches && fenceMatches.length % 2 !== 0) return true;

  // Inline code: odd number of `` ` `` on the current line before pos
  // (matched runs not split here — good enough; the common case is
  // single-tick spans).
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineBefore = before.slice(lineStart);
  const tickCount = (lineBefore.match(/`/g) || []).length;
  return tickCount % 2 !== 0;
};

/** Find the expansion for `word`. Exact-case match wins; falls back
 *  to case-insensitive search. Returns null if no match. */
const findExpansion = (word: string, abbreviations: Record<string, string>): string | null => {
  // Exact case-sensitive match (allows callers to define case-specific
  // variants like { mfg, MFG } with different expansions).
  if (Object.prototype.hasOwnProperty.call(abbreviations, word)) {
    return abbreviations[word] ?? null;
  }
  // Case-insensitive fallback — most common path.
  const lower = word.toLowerCase();
  for (const key of Object.keys(abbreviations)) {
    if (key.toLowerCase() === lower) return abbreviations[key] ?? null;
  }
  return null;
};

/**
 * Inspect the textarea after a user keystroke; if the most recently
 * typed character is a word boundary AND the word preceding it matches
 * a key in `abbreviations` AND the position is not inside a code zone,
 * perform the expansion via `execCommand` (undo-stack-friendly) and
 * arm the backspace-restore window.
 *
 * Returns `true` if an expansion happened.
 */
export const tryExpand = (textarea: HTMLTextAreaElement, abbreviations: Record<string, string> | undefined): boolean => {
  if (suppressNextExpansion) {
    suppressNextExpansion = false;
    return false;
  }
  if (!abbreviations || Object.keys(abbreviations).length === 0) return false;

  const value = textarea.value;
  const caret = textarea.selectionStart;
  if (caret === 0 || caret !== textarea.selectionEnd) return false;

  const triggerChar = value[caret - 1];
  if (!triggerChar || !TRIGGER_CHARS.has(triggerChar)) return false;

  // Walk back from just-before-trigger to find the word's start.
  let wordEnd = caret - 1;
  let wordStart = wordEnd;
  while (wordStart > 0 && WORD_CHAR.test(value[wordStart - 1]!)) wordStart--;
  if (wordStart === wordEnd) return false;

  const word = value.slice(wordStart, wordEnd);
  const expansion = findExpansion(word, abbreviations);
  if (expansion === null) return false;

  if (isInCodeZone(value, wordStart)) return false;

  // Replace [wordStart .. caret] = "word + trigger" with
  // "expansion + trigger". Keeping the trigger as part of the
  // replacement keeps the browser cursor placement natural — it lands
  // right after the trigger, same column as the user typed.
  const replacement = expansion + triggerChar;
  textarea.setSelectionRange(wordStart, caret);
  document.execCommand("insertText", false, replacement);

  lastExpansion = { textarea, startOffset: wordStart, originalWord: word, triggerChar, expansion };
  // Suppress the immediately-following input event so an expansion
  // whose tail happens to match another abbreviation doesn't loop.
  suppressNextExpansion = true;
  return true;
};

/**
 * If the last action on `textarea` was an expansion and the cursor is
 * still at the expansion's tail position, revert the expansion to the
 * original abbreviation + trigger char.
 *
 * Returns `true` if a restore happened — caller should `preventDefault`
 * to suppress the native backspace.
 */
export const tryRestore = (textarea: HTMLTextAreaElement): boolean => {
  const last = lastExpansion;
  if (!last || last.textarea !== textarea) return false;

  const value = textarea.value;
  const tail = last.startOffset + last.expansion.length + last.triggerChar.length;
  if (textarea.selectionStart !== tail || textarea.selectionEnd !== tail) return false;

  const expected = last.expansion + last.triggerChar;
  if (value.slice(last.startOffset, tail) !== expected) return false;

  // Suppress the expansion-check on the input event that our own
  // execCommand will fire — otherwise the just-restored word would
  // immediately re-expand into the same expansion.
  suppressNextExpansion = true;
  textarea.setSelectionRange(last.startOffset, tail);
  document.execCommand("insertText", false, last.originalWord + last.triggerChar);

  lastExpansion = null;
  return true;
};
