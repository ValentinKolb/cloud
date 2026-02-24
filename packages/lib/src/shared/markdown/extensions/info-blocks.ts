/**
 * Info Blocks Extension for Marked
 *
 * Renders custom info blocks with syntax:
 * ::: note
 * Content here
 * :::
 *
 * Supported types: note, info, success, warning, danger
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml } from "../shared";

type BlockType = "note" | "info" | "success" | "warning" | "danger";

const blockConfig: Record<BlockType, { icon: string; label: string; classes: string }> = {
  note: {
    icon: "ti-chevron-right",
    label: "Note",
    classes: "border-l-4 border-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200",
  },
  info: {
    icon: "ti-info-circle",
    label: "Info",
    classes: "border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200",
  },
  success: {
    icon: "ti-check",
    label: "Success",
    classes: "border-l-4 border-green-400 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200",
  },
  warning: {
    icon: "ti-alert-circle",
    label: "Warning",
    classes: "border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200",
  },
  danger: {
    icon: "ti-alert-hexagon",
    label: "Danger",
    classes: "border-l-4 border-red-400 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200",
  },
};

const renderInlineContent = (content: string): string => {
  return content
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-sm">$1</code>')
    .replace(/\n/g, "<br>");
};

export function infoBlocksExtension(): MarkedExtension {
  return {
    extensions: [
      {
        name: "infoBlock",
        level: "block",
        start(src: string) {
          return src.match(/^:::/)?.index;
        },
        tokenizer(src: string) {
          const match = src.match(/^:::(\w+)\s*\n([\s\S]*?)\n:::/);
          if (!match) return undefined;

          const typeStr = match[1]?.toLowerCase() as BlockType;
          if (!blockConfig[typeStr]) return undefined;

          return {
            type: "infoBlock",
            raw: match[0],
            blockType: typeStr,
            content: match[2]?.trim() ?? "",
          };
        },
        renderer(token: Tokens.Generic) {
          const blockType = token.blockType as BlockType;
          const config = blockConfig[blockType];
          const content = escapeHtml(token.content as string);
          const renderedContent = renderInlineContent(content);

          return `<div class="info-block ${config.classes} p-4 rounded my-2">
  <div class="flex items-center gap-1.5 font-semibold mb-1">
    <i class="ti ${config.icon} shrink-0"></i>
    <span>${config.label}</span>
  </div>
  <div>${renderedContent}</div>
</div>`;
        },
      },
    ],
  };
}
