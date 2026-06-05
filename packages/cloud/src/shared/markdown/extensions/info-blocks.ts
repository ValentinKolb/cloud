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
    classes: "info-block-note",
  },
  info: {
    icon: "ti-info-circle",
    label: "Info",
    classes: "info-block-info",
  },
  success: {
    icon: "ti-check",
    label: "Success",
    classes: "info-block-success",
  },
  warning: {
    icon: "ti-alert-circle",
    label: "Warning",
    classes: "info-block-warning",
  },
  danger: {
    icon: "ti-alert-hexagon",
    label: "Danger",
    classes: "info-block-danger",
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
