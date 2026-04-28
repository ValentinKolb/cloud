/**
 * Links extension for marked
 *
 * Renders links with the same visual style as the CodeMirror editor:
 * - Shows [label] in bold followed by an arrow icon
 * - Opens in new tab with noopener,noreferrer
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml, LINK_STYLES } from "../shared";

export function linksExtension(): MarkedExtension {
  return {
    renderer: {
      link(token: Tokens.Link): string {
        const { href, title, text } = token;

        // Build title attribute if provided
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";

        // Match CodeMirror style: [label] with arrow icon
        return (
          `<span class="${LINK_STYLES.wrapper}">` +
          `<span class="${LINK_STYLES.label}">[${escapeHtml(text)}]</span>` +
          `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer" ` +
          `class="${LINK_STYLES.icon}">` +
          `<i class="ti ti-arrow-up-right text-xs"></i>` +
          `</a>` +
          `</span>`
        );
      },
    },
  };
}
