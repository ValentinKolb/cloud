/**
 * Server-side Markdown renderer using marked.js
 *
 * This module provides markdown rendering that produces HTML matching
 * the visual appearance of the CodeMirror editor extensions.
 */

import { Marked } from "marked";
import { infoBlocksExtension } from "./extensions/info-blocks";
import { taskListExtension } from "./extensions/task-list";
import { tablesExtension } from "./extensions/tables";
import { linksExtension } from "./extensions/links";
import { imagesExtension } from "./extensions/images";
import { codeExtension } from "./extensions/code";
import { katexExtension } from "./extensions/katex";
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

  return marked;
};

const marked = createMarked();

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

  return html;
}

/**
 * Render markdown to HTML synchronously.
 */
export function renderMarkdownSync(content: string): string {
  if (!content || typeof content !== "string") return "";

  const html = marked.parse(content);
  if (typeof html !== "string") return "";

  return html;
}

export { marked };

export const markdown = {
  render: renderMarkdown,
  renderSync: renderMarkdownSync,
  marked,
  client: markdownClient,
} as const;
