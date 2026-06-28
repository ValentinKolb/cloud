/**
 * Overlay-mode rendering helpers for editors that mirror their
 * textarea in a preview div (the "overtype" pattern).
 *
 * The renderer injects a `GHOST_SENTINEL` PUA char at the caret in
 * the source text BEFORE the caller's `highlight` function runs.
 * After highlighting, the sentinel is replaced with either:
 *
 *   - A `<span class="completion-ghost" data-completion-anchor>` containing
 *     the not-yet-typed tail of the active suggestion + a `→` arrow.
 *   - An invisible `<span class="completion-caret-anchor" data-completion-anchor>`
 *     used purely for positioning the dropdown when no ghost is shown.
 *
 * The `data-completion-anchor` attribute is what `positionDropdown`
 * queries to find the caret's pixel position. The same attribute on
 * both shapes lets the editor's positioning code stay agnostic of
 * which shape is currently rendered.
 *
 * This module is markdown-agnostic. The `highlight` callback is the
 * caller's responsibility — MarkdownEditor passes its markdown
 * highlighter, AutocompleteEditor passes either an identity-escape
 * or a user-provided syntax highlighter.
 */

import { GHOST_SENTINEL } from "./engine";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Identity highlighter — escapes HTML and preserves whitespace 1:1.
 * Use this when the editor has no syntax-highlighting needs but
 * still wants the overlay (for ghost preview / dropdown anchor).
 */
export const plainTextHighlight = (text: string): string => escapeHtml(text);

export type RenderOptions = {
  /** Optional ghost preview to inject at `at` (the cursor offset in
   * `text`). The wrapper carries `data-completion-anchor`. */
  ghost?: { at: number; text: string };
  /** Optional invisible anchor (used when a dropdown is open but no
   * ghost is shown — e.g. typed text equals the highlighted row). */
  anchor?: { at: number };
};

/**
 * Render text through `highlight`, then substitute the sentinel with
 * either a ghost wrapper or an invisible anchor. Both carry
 * `data-completion-anchor` so the editor can `querySelector` for
 * positioning.
 *
 * The `highlight` function receives text that may contain the
 * sentinel. The sentinel is a private-use codepoint with no special
 * meaning to any markdown/HTML regex, so highlighters generally pass
 * it through untouched — it ends up in the output verbatim, then
 * gets substituted here.
 */
export const renderWithOverlay = (text: string, highlight: (text: string) => string, options: RenderOptions = {}): string => {
  const { ghost, anchor } = options;

  // Ghost wins over anchor: when both are conceptually present, the
  // ghost wrapper already carries the anchor attribute, no separate
  // marker needed. Only inject when either is requested.
  const injection = ghost ?? anchor;
  let workText = text;
  if (injection) {
    workText = text.slice(0, injection.at) + GHOST_SENTINEL + text.slice(injection.at);
  }

  let html = highlight(workText);

  if (ghost) {
    // Plain Unicode arrow rather than an icon-font glyph — overlays
    // typically lock `font-family` to monospace (overtype pattern),
    // so an icon font wouldn't take effect and we'd get a tofu box.
    // `→` (U+2192) is available in every monospace font.
    const ghostHtml = `<span class="completion-ghost" data-completion-anchor>${escapeHtml(ghost.text)}<span class="completion-ghost-arrow" aria-hidden="true">→</span></span>`;
    html = html.split(GHOST_SENTINEL).join(ghostHtml);
  } else if (anchor) {
    // Zero-width inline-block so layout doesn't shift but
    // `getBoundingClientRect()` returns the caret's pixel position.
    // `​` keeps the span "non-empty" for browsers that collapse
    // empty inline elements to zero size.
    const anchorHtml = `<span class="completion-caret-anchor" data-completion-anchor aria-hidden="true">​</span>`;
    html = html.split(GHOST_SENTINEL).join(anchorHtml);
  }
  return html;
};
