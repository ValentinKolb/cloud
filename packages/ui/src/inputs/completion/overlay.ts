import { GHOST_SENTINEL } from "./engine";

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const plainTextHighlight = escapeHtml;

export type RenderOptions = {
  ghost?: { at: number; text: string };
  anchor?: { at: number };
};

export const renderWithOverlay = (text: string, highlighter: (text: string) => string, options: RenderOptions = {}): string => {
  const injection = options.ghost ?? options.anchor;
  const workText = injection ? `${text.slice(0, injection.at)}${GHOST_SENTINEL}${text.slice(injection.at)}` : text;
  let html = highlighter(workText);
  if (options.ghost) {
    html = html
      .split(GHOST_SENTINEL)
      .join(
        `<span class="k2b-completion-ghost" data-completion-anchor>${escapeHtml(options.ghost.text)}<span class="k2b-completion-ghost__arrow" aria-hidden="true">→</span></span>`,
      );
  } else if (options.anchor) {
    html = html.split(GHOST_SENTINEL).join('<span class="k2b-completion-anchor" data-completion-anchor aria-hidden="true">\u200b</span>');
  }
  return html;
};
