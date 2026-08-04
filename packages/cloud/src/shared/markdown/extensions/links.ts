/**
 * Links extension for marked
 *
 * Renders links with the same visual style as the CodeMirror editor:
 * - Shows [label] in bold followed by an arrow icon
 * - Opens in new tab with noopener,noreferrer
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml, LINK_STYLES } from "../shared";

export type LinksExtensionOptions = {
  /** Open external links in a new tab by default. */
  externalTarget?: "_blank" | "_self";
  /** Existing content keeps `_blank`; help opts into in-app navigation. */
  internalTarget?: "_blank" | "_self";
};

const isExternalHref = (href: string) => /^(?:https?:)?\/\//i.test(href);

export function linksExtension(options: LinksExtensionOptions = {}): MarkedExtension {
  return {
    renderer: {
      link(token: Tokens.Link): string {
        const { href, title, text } = token;

        // Build title attribute if provided
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";

        // Match CodeMirror style: [label] with arrow icon
        const target = isExternalHref(href) ? (options.externalTarget ?? "_blank") : (options.internalTarget ?? "_blank");
        const targetAttrs = target === "_blank" ? ' target="_blank" rel="noopener noreferrer"' : "";

        return (
          `<a href="${escapeHtml(href)}"${titleAttr}${targetAttrs} class="${LINK_STYLES.link}">` +
          `<span class="${LINK_STYLES.label}">[${escapeHtml(text)}]</span>` +
          `<i class="${LINK_STYLES.icon} ti ti-arrow-up-right text-xs" aria-hidden="true"></i>` +
          `</a>`
        );
      },
    },
  };
}
