/**
 * KaTeX extension for marked
 *
 * Renders LaTeX math expressions server-side:
 * - Inline: $..$ or \(..\)
 * - Block: $$...$$ or \[..\] or ```math
 */

import type { MarkedExtension } from "marked";
import katex from "katex";

function renderBlockMath(latex: string): string {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
    });
    return `<div class="md-katex-block my-3 flex items-center justify-center">${html}</div>`;
  } catch {
    return `<div class="md-katex-block my-3 flex items-center justify-center text-red-500 text-sm"><i class="ti ti-alert-circle mr-1"></i> Invalid LaTeX</div>`;
  }
}

function renderInlineMath(latex: string): string {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
    });
    return `<span class="md-katex-inline">${html}</span>`;
  } catch {
    return `<span class="md-katex-inline text-red-500 font-mono text-sm">$${latex}$</span>`;
  }
}

export function katexExtension(): MarkedExtension {
  return {
    extensions: [
      // ```math code blocks
      {
        name: "mathCodeBlock",
        level: "block",
        start(src: string) {
          const match = src.match(/^```math/m);
          return match ? match.index : undefined;
        },
        tokenizer(src: string) {
          const match = /^```math\n([\s\S]*?)\n```/.exec(src);
          if (match) {
            return {
              type: "mathCodeBlock",
              raw: match[0],
              latex: match[1]!.trim(),
            };
          }
          return undefined;
        },
        renderer(token: any) {
          return renderBlockMath(token.latex);
        },
      },
      // Block math with $$ ... $$
      {
        name: "blockMath",
        level: "block",
        start(src: string) {
          const match = src.match(/\$\$/);
          return match ? match.index : undefined;
        },
        tokenizer(src: string) {
          const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
          if (match) {
            return {
              type: "blockMath",
              raw: match[0],
              latex: match[1]!.trim(),
            };
          }
          return undefined;
        },
        renderer(token: any) {
          return renderBlockMath(token.latex);
        },
      },
      // Inline math with $ ... $
      {
        name: "inlineMath",
        level: "inline",
        start(src: string) {
          const match = src.match(/(?<!\$)\$(?!\$)/);
          return match ? match.index : undefined;
        },
        tokenizer(src: string) {
          const match = /^(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/.exec(src);
          if (match) {
            return {
              type: "inlineMath",
              raw: match[0],
              latex: match[1]!.trim(),
            };
          }
          return undefined;
        },
        renderer(token: any) {
          return renderInlineMath(token.latex);
        },
      },
    ],
  };
}
