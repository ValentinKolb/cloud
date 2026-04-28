/**
 * Tables Extension for Marked
 *
 * Renders markdown tables with styling matching the CodeMirror extension.
 * Supports cell formatting for NULL, booleans, dates, and numbers.
 */

import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml } from "../shared";

const formatCell = (cell: string): string => {
  const trimmed = cell.trim();

  // NULL
  if (trimmed.toLowerCase() === "null") {
    return '<span class="text-gray-400 italic">NULL</span>';
  }

  // Boolean
  if (trimmed.toLowerCase() === "true") {
    return '<span class="text-green-600">true</span>';
  }
  if (trimmed.toLowerCase() === "false") {
    return '<span class="text-red-600">false</span>';
  }

  // ISO datetime
  if (trimmed.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
    try {
      const date = new Date(trimmed);
      return date.toLocaleString();
    } catch {
      return escapeHtml(trimmed);
    }
  }

  // Number with decimals
  const num = parseFloat(trimmed);
  if (!isNaN(num) && trimmed.includes(".") && !Number.isInteger(num)) {
    return num.toFixed(4).replace(/\.?0+$/, "");
  }

  return escapeHtml(trimmed);
};

export function tablesExtension(): MarkedExtension {
  return {
    renderer: {
      table(token: Tokens.Table): string {
        const headerCells = token.header
          .map(
            (cell) =>
              `<th class="px-3 py-2 text-left font-medium bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap min-w-30">${this.parser.parseInline(
                cell.tokens,
              )}</th>`,
          )
          .join("");

        const rows = token.rows
          .map((row) => {
            const cells = row
              .map((cell, i) => {
                const content = this.parser.parseInline(cell.tokens);
                const bgClass = i % 2 === 0 ? "bg-gray-50 dark:bg-gray-800/20" : "";
                return `<td class="px-3 py-2 whitespace-nowrap min-w-30 ${bgClass}">${formatCell(content)}</td>`;
              })
              .join("");
            return `<tr class="hover:font-semibold">${cells}</tr>`;
          })
          .join("\n");

        const rowCount = token.rows.length;

        return `<div class="cm-table-widget my-2">
  <div class="flex flex-col">
    <div class="overflow-x-auto rounded">
      <table class="min-w-full text-sm tabular-nums">
        <thead><tr>${headerCells}</tr></thead>
        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">${rows}</tbody>
      </table>
    </div>
    <div class="text-center text-xs mt-2">${rowCount} row${rowCount === 1 ? "" : "s"}</div>
  </div>
</div>`;
      },
    },
  };
}
