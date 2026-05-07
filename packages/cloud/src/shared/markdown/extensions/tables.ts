/**
 * Tile-style markdown table renderer for `marked`.
 *
 * Emits the three-layer markup that `utilities-table-tile.css` styles:
 *   <div class="md-table-wrap">      — horizontal scroll
 *     <table class="md-table">       — layout reset
 *       <th|td>
 *         <span class="md-table-cell"> — visible tile
 *
 * Per-column alignment from `:---:` syntax flows through `token.align`
 * to a `md-align-{left,center,right}` class on each cell.
 *
 * Markdown tables are hand-edited and small — no pagination, no
 * NULL/datetime cell-formatting, no zebra columns. If you need any of
 * those, you're rendering data not prose; use the Grids app.
 */
import type { MarkedExtension, Tokens } from "marked";

type Align = "left" | "right" | "center" | null;

const alignClass = (align: Align): string => {
  if (align === "right") return " md-align-right";
  if (align === "center") return " md-align-center";
  return "";
};

export function tablesExtension(): MarkedExtension {
  return {
    renderer: {
      table(token: Tokens.Table): string {
        const align = token.align ?? [];

        const headerCells = token.header
          .map((cell, i) => {
            const cls = `md-table-cell${alignClass(align[i] ?? null)}`;
            return `<th><span class="${cls}">${this.parser.parseInline(cell.tokens)}</span></th>`;
          })
          .join("");

        const rows = token.rows
          .map((row) => {
            const cells = row
              .map((cell, i) => {
                const cls = `md-table-cell${alignClass(align[i] ?? null)}`;
                return `<td><span class="${cls}">${this.parser.parseInline(cell.tokens)}</span></td>`;
              })
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");

        return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  };
}
