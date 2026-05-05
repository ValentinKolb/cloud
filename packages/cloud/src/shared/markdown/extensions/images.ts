/**
 * Images extension for marked
 *
 * Renders images with the same visual style as the CodeMirror editor:
 * - Centered figure with max-height constraint
 * - Rounded border
 * - Optional caption from alt text
 *
 * Supports an optional Pandoc/HFM-style size suffix on the URL:
 *
 *     ![alt](https://example.com/photo.png =400x300)   // both
 *     ![alt](https://example.com/photo.png =400x)      // width only
 *     ![alt](https://example.com/photo.png =x300)      // height only
 *
 * Marked's default tokenizer treats the trailing ` =WxH` as part of the
 * URL — we parse and strip it here before emitting the `<img>` tag.
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml, IMAGE_STYLES } from "../shared";

const SIZE_SUFFIX_REGEX = /\s+=(\d+)?x(\d+)?$/;

type ParsedImage = {
  href: string;
  width: string | null;
  height: string | null;
};

const parseImageUrl = (href: string): ParsedImage => {
  const match = SIZE_SUFFIX_REGEX.exec(href);
  if (!match) return { href, width: null, height: null };
  return {
    href: href.slice(0, match.index),
    width: match[1] ?? null,
    height: match[2] ?? null,
  };
};

export function imagesExtension(): MarkedExtension {
  return {
    renderer: {
      image(token: Tokens.Image): string {
        const { href: rawHref, title, text: alt } = token;
        const { href, width, height } = parseImageUrl(rawHref);

        // Build the image element
        const imgAttrs = [`src="${escapeHtml(href)}"`, `alt="${escapeHtml(alt || "")}"`, `loading="lazy"`, `class="${IMAGE_STYLES.img}"`];

        if (title) imgAttrs.push(`title="${escapeHtml(title)}"`);
        if (width) imgAttrs.push(`width="${width}"`);
        if (height) imgAttrs.push(`height="${height}"`);

        // Inline style overrides the global `max-height: 400px` from
        // IMAGE_STYLES.img only when the user opted into a custom size.
        if (width || height) {
          const styles: string[] = ["max-height: none"];
          if (width) styles.push(`max-width: ${width}px`);
          imgAttrs.push(`style="${styles.join("; ")}"`);
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
