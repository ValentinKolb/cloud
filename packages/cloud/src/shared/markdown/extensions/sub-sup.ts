/**
 * Subscript and Superscript extensions for marked.
 *
 *     H~2~O           → H<sub>2</sub>O
 *     E=mc^2^         → E=mc<sup>2</sup>
 *
 * Conservative tokenisers: the inner content cannot contain whitespace or
 * the marker character. That avoids accidentally swallowing strikethrough
 * (`~~text~~`), regular tildes used as separators, or `^` used as the
 * regex caret in inline code.
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml } from "../shared";

export function subSupExtension(): MarkedExtension {
  return {
    extensions: [
      {
        name: "subscript",
        level: "inline",
        start(src: string) {
          // Single `~` not preceded or followed by another `~`.
          return src.match(/(?<!~)~(?!~)/)?.index;
        },
        tokenizer(src: string) {
          const match = /^(?<!~)~(?!~)([^~\s]+)~(?!~)/.exec(src);
          if (!match) return undefined;
          return {
            type: "subscript",
            raw: match[0],
            text: match[1] ?? "",
          };
        },
        renderer(token: Tokens.Generic) {
          return `<sub>${escapeHtml(String(token.text))}</sub>`;
        },
      },
      {
        name: "superscript",
        level: "inline",
        start(src: string) {
          return src.match(/\^/)?.index;
        },
        tokenizer(src: string) {
          const match = /^\^([^\^\s]+)\^/.exec(src);
          if (!match) return undefined;
          return {
            type: "superscript",
            raw: match[0],
            text: match[1] ?? "",
          };
        },
        renderer(token: Tokens.Generic) {
          return `<sup>${escapeHtml(String(token.text))}</sup>`;
        },
      },
    ],
  };
}
