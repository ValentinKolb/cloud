/**
 * Code extension for marked
 *
 * Renders code blocks and inline code with consistent styling.
 * For now, this provides basic code formatting without syntax highlighting.
 * Full syntax highlighting can be added later with highlight.js if needed.
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml } from "../shared";

/** Base64-encode a UTF-8 string for embedding in a `data-` attribute.
 *  Server-safe: works in Bun runtime. The matching client-side decoder
 *  uses `atob` + `decodeURIComponent` (see `frontend/lib/script/read-mode.ts`). */
const encodeScriptSource = (source: string): string => {
  // `Buffer` exists in Bun's server-side runtime. The fallback path
  // (`unescape(encodeURIComponent(...))` + `btoa`) is for any
  // browser/edge environment that imports this module without Buffer.
  if (typeof Buffer !== "undefined") return Buffer.from(source, "utf8").toString("base64");
  return btoa(unescape(encodeURIComponent(source)));
};

export function codeExtension(): MarkedExtension {
  return {
    renderer: {
      code(token: Tokens.Code): string {
        const { text, lang } = token;
        const escapedCode = escapeHtml(text);
        const langLower = lang?.toLowerCase();
        const isMermaid = langLower === "mermaid";
        const isScript = langLower === "script";

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

        // ```script blocks: emit a wrapper carrying the source as a
        // base64 `data-` attribute + an empty output container. The
        // client-side `enhanceReadModeScripts` (see frontend/lib/script
        // /read-mode.ts) finds these wrappers, decodes the source, and
        // either runs it (when notebook.scriptsEnabled is true) or
        // shows the source as a regular code block (when false).
        // Decision is made client-side because the markdown layer is
        // notebook-agnostic — `scriptsEnabled` is a per-notebook flag.
        // The fallback (source) stays in the DOM (just `display: none`
        // when scripts are active) so view-source / accessibility
        // tooling sees the original code. Skip the carrier when
        // there's no source — empty fences shouldn't activate.
        if (isScript) {
          const sourceB64 = encodeScriptSource(text);
          return (
            `<div class="md-script-block my-3" data-script-source="${sourceB64}">` +
            `<pre class="md-script-source bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-4 overflow-x-auto">` +
            `<code class="text-sm font-mono text-gray-800 dark:text-gray-200 whitespace-pre language-script">${escapedCode}</code>` +
            `</pre>` +
            `<div class="md-script-output"></div>` +
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
