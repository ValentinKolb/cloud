/**
 * Emoji extension for marked
 *
 * Converts :shortcode: patterns to native emoji characters.
 * Skips emoji inside inline code and code blocks.
 */

import type { MarkedExtension } from "marked";
import EmojiConvertor from "emoji-js";

const emojiConverter = new EmojiConvertor();
emojiConverter.replace_mode = "unified";
emojiConverter.allow_native = true;

const emojiRegex = /:([a-zA-Z0-9_+-]+):/g;

/**
 * Convert emoji shortcodes to native emoji in text.
 * Returns the text with shortcodes replaced by actual emoji characters.
 */
function convertEmoji(text: string): string {
  return text.replace(emojiRegex, (match) => {
    const converted = emojiConverter.replace_colons(match);
    // If conversion failed, return original
    return converted !== match ? converted : match;
  });
}

export function emojiExtension(): MarkedExtension {
  return {
    extensions: [
      {
        name: "emoji",
        level: "inline",
        start(src: string) {
          return src.indexOf(":");
        },
        tokenizer(src: string) {
          const match = /^:([a-zA-Z0-9_+-]+):/.exec(src);
          if (match) {
            const shortcode = match[0];
            const converted = emojiConverter.replace_colons(shortcode);
            // Only create token if it's a valid emoji
            if (converted !== shortcode) {
              return {
                type: "emoji",
                raw: match[0],
                shortcode: match[0],
                emoji: converted,
              };
            }
          }
          return undefined;
        },
        renderer(token) {
          return `<span class="emoji" title="${token.shortcode}">${token.emoji}</span>`;
        },
      },
    ],
  };
}
