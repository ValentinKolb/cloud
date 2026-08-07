import { GHOST_SENTINEL } from "./engine";

const ANCHOR_SENTINEL = String.fromCharCode(0xe011);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const plainTextHighlight = escapeHtml;

export type RenderOptions = {
  ghost?: { at: number; text: string };
  anchor?: { at: number };
};

export const renderWithOverlay = (text: string, highlighter: (text: string) => string, options: RenderOptions = {}): string => {
  const injections = [
    options.anchor ? { at: options.anchor.at, marker: ANCHOR_SENTINEL, order: 1 } : undefined,
    options.ghost ? { at: options.ghost.at, marker: GHOST_SENTINEL, order: 0 } : undefined,
  ]
    .filter((injection): injection is { at: number; marker: string; order: number } => Boolean(injection))
    .sort((left, right) => right.at - left.at || left.order - right.order);
  const workText = injections.reduce(
    (value, injection) => `${value.slice(0, injection.at)}${injection.marker}${value.slice(injection.at)}`,
    text,
  );
  let html = highlighter(workText);
  if (options.ghost) {
    html = html
      .split(GHOST_SENTINEL)
      .join(
        `<span class="k2b-completion-ghost"${options.anchor ? "" : " data-completion-anchor"}>${escapeHtml(options.ghost.text)}<span class="k2b-completion-ghost__arrow" aria-hidden="true">→</span></span>`,
      );
  }
  if (options.anchor) {
    html = html.split(ANCHOR_SENTINEL).join('<span class="k2b-completion-anchor" data-completion-anchor aria-hidden="true">\u200b</span>');
  }
  return html;
};
