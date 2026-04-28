/**
 * Code extension for marked
 *
 * Renders code blocks and inline code with consistent styling.
 * For now, this provides basic code formatting without syntax highlighting.
 * Full syntax highlighting can be added later with highlight.js if needed.
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml } from "../shared";

export function codeExtension(): MarkedExtension {
  return {
    renderer: {
      code(token: Tokens.Code): string {
        const { text, lang } = token;
        const escapedCode = escapeHtml(text);
        const isMermaid = lang?.toLowerCase() === "mermaid";

        // Language class for syntax highlighting / mermaid detection
        const langClass = lang ? ` language-${escapeHtml(lang)}` : "";

        // Special rendering for mermaid blocks with fixed height container
        if (isMermaid) {
          return (
            `<div class="md-mermaid-block my-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" style="height: 400px;">` +
            `<div class="h-full w-full flex items-center justify-center p-4">` +
            `<pre class="hidden"><code class="language-mermaid">${escapedCode}</code></pre>` +
            `<div class="md-mermaid-loading text-dimmed text-sm flex items-center gap-2">` +
            `<i class="ti ti-loader-2 animate-spin"></i> Loading diagram...` +
            `</div>` +
            `</div>` +
            `</div>`
          );
        }

        // Language badge if specified
        const langBadge = lang
          ? `<span class="absolute top-2 right-2 text-xs text-gray-400 dark:text-gray-500 font-mono select-none">${escapeHtml(lang)}</span>`
          : "";

        return (
          `<div class="md-code-block relative my-3">` +
          langBadge +
          `<pre class="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-4 overflow-x-auto">` +
          `<code class="text-sm font-mono text-gray-800 dark:text-gray-200 whitespace-pre${langClass}">${escapedCode}</code>` +
          `</pre>` +
          `</div>`
        );
      },

      codespan(token: Tokens.Codespan): string {
        const escapedCode = escapeHtml(token.text);
        return `<code class="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-sm font-mono">${escapedCode}</code>`;
      },
    },
  };
}
