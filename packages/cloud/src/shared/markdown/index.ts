/**
 * Server-side Markdown renderer using marked.js
 *
 * This module provides markdown rendering that produces HTML matching
 * the visual appearance of the CodeMirror editor extensions.
 */

import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { infoBlocksExtension } from "./extensions/info-blocks";
import { taskListExtension } from "./extensions/task-list";
import { tablesExtension } from "./extensions/tables";
import { linksExtension } from "./extensions/links";
import { imagesExtension } from "./extensions/images";
import { codeExtension } from "./extensions/code";
import { katexExtension } from "./extensions/katex";
import { markExtension } from "./extensions/mark";
import { subSupExtension } from "./extensions/sub-sup";
import { markdownClient } from "./client";

// Create a configured marked instance
const createMarked = () => {
  const marked = new Marked();

  marked.use({
    breaks: true,
    gfm: true,
  });

  // Apply extensions in order
  // Note: katexExtension must come before codeExtension to handle ```math blocks
  marked.use(infoBlocksExtension());
  marked.use(taskListExtension());
  marked.use(tablesExtension());
  marked.use(linksExtension());
  marked.use(imagesExtension());
  marked.use(katexExtension());
  marked.use(codeExtension());
  // Inline-style decorators come last so they run after structural tokenizers.
  marked.use(markExtension());
  marked.use(subSupExtension());

  return marked;
};

const marked = createMarked();

const sanitizeRenderedHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "annotation",
      "br",
      "div",
      "figcaption",
      "figure",
      "i",
      "img",
      "input",
      "mark",
      "math",
      "mfrac",
      "mi",
      "mn",
      "mo",
      "mover",
      "mrow",
      "msqrt",
      "msub",
      "msubsup",
      "msup",
      "mtext",
      "semantics",
      "span",
      "sub",
      "sup",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
    ],
    allowedAttributes: {
      "*": ["aria-hidden", "aria-label", "class", "title"],
      a: ["href", "name", "rel", "target", "title"],
      annotation: ["encoding"],
      code: ["class"],
      div: ["class", "data-script-source", "style"],
      img: ["alt", "class", "height", "loading", "src", "title", "width", "style"],
      input: ["checked", "class", "disabled", "type"],
      math: ["xmlns"],
      pre: ["class"],
      span: ["aria-hidden", "class", "style", "title"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "note", "attach"],
    allowedSchemesByTag: {
      img: ["http", "https", "attach"],
    },
    allowedStyles: {
      div: {
        height: [/^\d+(?:\.\d+)?px$/],
      },
      img: {
        "max-height": [/^none$/, /^\d+(?:\.\d+)?px$/],
        "max-width": [/^\d+(?:\.\d+)?px$/],
      },
      span: {
        "margin-right": [/^-?\d+(?:\.\d+)?em$/],
        top: [/^-?\d+(?:\.\d+)?em$/],
      },
    },
  });

/**
 * Render markdown to HTML for server-side display.
 * The output matches the visual styling of the CodeMirror editor.
 *
 * Supported features:
 * - GFM (GitHub Flavored Markdown)
 * - Info blocks (:::note, :::info, :::success, :::warning, :::danger)
 * - Task lists with checkboxes
 * - Tables with cell formatting
 * - Styled links and images
 * - Code blocks with language badges
 * - Mermaid diagram containers (requires client-side init)
 *
 * @example
 * ```tsx
 * // In page.tsx (server-side):
 * import { renderMarkdown } from "@/shared/markdown";
 * const html = renderMarkdown(markdownContent);
 *
 * // Pass to MarkdownView component:
 * import MarkdownView from "@/ui/misc/MarkdownView";
 * <MarkdownView html={html} />
 * ```
 *
 * @see MarkdownView component for displaying the rendered HTML
 * @see initMarkdownEnhancements for client-side Mermaid support
 */
export function renderMarkdown(content: string): string {
  if (!content || typeof content !== "string") return "";

  const html = marked.parse(content);
  if (typeof html !== "string") return "";

  return sanitizeRenderedHtml(html);
}

/**
 * Render markdown to HTML synchronously.
 */
export function renderMarkdownSync(content: string): string {
  if (!content || typeof content !== "string") return "";

  const html = marked.parse(content);
  if (typeof html !== "string") return "";

  return sanitizeRenderedHtml(html);
}

export { marked };

export const markdown = {
  render: renderMarkdown,
  renderSync: renderMarkdownSync,
  marked,
  client: markdownClient,
} as const;
