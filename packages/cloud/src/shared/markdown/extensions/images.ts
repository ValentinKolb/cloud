/**
 * Images extension for marked
 *
 * Renders images with the same visual style as the CodeMirror editor:
 * - Centered figure with max-height constraint
 * - Rounded border
 * - Optional caption from alt text
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml, IMAGE_STYLES } from "../shared";

export function imagesExtension(): MarkedExtension {
  return {
    renderer: {
      image(token: Tokens.Image): string {
        const { href, title, text: alt } = token;

        // Build the image element
        const imgAttrs = [`src="${escapeHtml(href)}"`, `alt="${escapeHtml(alt || "")}"`, `loading="lazy"`, `class="${IMAGE_STYLES.img}"`];

        if (title) {
          imgAttrs.push(`title="${escapeHtml(title)}"`);
        }

        const imgHtml = `<img ${imgAttrs.join(" ")} />`;

        // Build caption if alt text provided
        const captionHtml = alt ? `<figcaption class="${IMAGE_STYLES.caption}">${escapeHtml(alt)}</figcaption>` : "";

        // Wrap in figure for centering
        return (
          `<div class="${IMAGE_STYLES.wrapper}">` +
          `<figure class="${IMAGE_STYLES.figure}">` +
          imgHtml +
          captionHtml +
          `</figure>` +
          `</div>`
        );
      },
    },
  };
}
