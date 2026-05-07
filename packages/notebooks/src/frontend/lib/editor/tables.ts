/**
 * Markdown table widget — renders a `| col | col |` block as a tile-style
 * preview when the cursor is on a different line, mirroring the read-mode
 * HTML produced by the `marked` extension. Same `.md-table-*` classes
 * flow through `cloud/src/styles/utilities-table-tile.css` so the visual
 * is identical in edit and read mode.
 *
 * Editing path:
 *  - Cursor inside the table's lines (or on the line right after it) →
 *    widget hidden, raw markdown source visible, normal CM editing.
 *  - Click on the widget → cursor dispatched to the table's start so the
 *    source-show range fires; user can then arrow-key around inside.
 *
 * Known limitation: `Decoration.replace({ block: true })` is atomic in
 * CodeMirror's cursor model, so arrow-up FROM BELOW jumps the cursor
 * past the entire widget instead of stopping at its boundary. Click +
 * arrow-down from above both work as expected.
 *
 * No pagination, no per-cell type detection, no column zebra — markdown
 * tables are hand-edited and small. Data tables belong in the Grids app.
 */
import { syntaxTree } from "@codemirror/language";
import { StateField, RangeSet, EditorState, type Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { evaluateFormula, formatValue, isFormula, isTotalRow, type EvalContext } from "@valentinkolb/cloud/shared";

type Align = "left" | "right" | "center" | null;

type TableData = {
  headers: string[];
  rows: string[][];
  align: Align[];
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const splitRow = (line: string): string[] => {
  const trimmed = line.trim();
  return trimmed
    .split("|")
    .map((cell) => cell.trim())
    .filter((_, i, arr) => !((i === 0 && trimmed.startsWith("|")) || (i === arr.length - 1 && trimmed.endsWith("|"))));
};

const parseAlign = (separator: string): Align => {
  const t = separator.trim();
  const startsColon = t.startsWith(":");
  const endsColon = t.endsWith(":");
  if (startsColon && endsColon) return "center";
  if (endsColon) return "right";
  if (startsColon) return "left";
  return null;
};

const parseTable = (text: string): TableData | null => {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return null;
  if (!lines[1]?.includes("---")) return null;

  const allRows = lines.map(splitRow);
  const headers = allRows[0] ?? [];
  const align: Align[] = (allRows[1] ?? []).map(parseAlign);
  const rows = allRows.slice(2);

  const cols = headers.length;
  const normalizedRows = rows.map((row) => {
    while (row.length < cols) row.push("");
    return row.slice(0, cols);
  });
  // Pad / truncate align to match column count.
  while (align.length < cols) align.push(null);

  return { headers, rows: normalizedRows, align: align.slice(0, cols) };
};

const alignClass = (align: Align): string => {
  if (align === "right") return " md-align-right";
  if (align === "center") return " md-align-center";
  return "";
};


/** Render a single body cell, evaluating formulas via the shared
 *  `formula.ts` module so the edit-mode preview matches the read-mode
 *  HTML byte-for-byte. */
const renderBodyCell = (cell: string, alignCls: string, ctx: EvalContext): string => {
  if (!isFormula(cell)) {
    return `<td><span class="md-table-cell${alignCls}">${escapeHtml(cell)}</span></td>`;
  }
  const result = evaluateFormula(cell, ctx);
  if (result.kind === "ok") {
    return `<td><span class="md-table-cell md-formula-ok${alignCls}" title="${escapeHtml(cell)}"><i class="ti ti-math-function"></i>${escapeHtml(formatValue(result.value))}</span></td>`;
  }
  const tooltip = result.suggestion ? `${result.message}\n→ Suggestion: ${result.suggestion}` : result.message;
  return `<td><span class="md-table-cell md-formula-error${alignCls}" title="${escapeHtml(tooltip)}">⚠ ${escapeHtml(cell)}</span></td>`;
};

const renderTable = (data: TableData): string => {
  const headerHtml = data.headers
    .map((h, i) => `<th><span class="md-table-cell${alignClass(data.align[i] ?? null)}">${escapeHtml(h)}</span></th>`)
    .join("");

  const bodyHtml = data.rows
    .map((row, rowIdx) => {
      const totalRow = isTotalRow(row);
      const cells = row
        .map((cell, colIdx) => {
          const alignCls = alignClass(data.align[colIdx] ?? null);
          const ctx: EvalContext = { headers: data.headers, rows: data.rows, currentRow: rowIdx, currentCol: colIdx };
          return renderBodyCell(cell, alignCls, ctx);
        })
        .join("");
      return totalRow ? `<tr class="md-table-total-row">${cells}</tr>` : `<tr>${cells}</tr>`;
    })
    .join("");

  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
};

/**
 * Inline live-preview widget for raw-mode formula cells. When the user
 * has the cursor inside a table (so the markdown source is visible),
 * we slip a small ` → <result> ` ghost after each `=...` cell so they
 * see whether their formula evaluates correctly without having to
 * leave the cell.
 *
 * Click-to-copy: clicking the OK preview copies the computed value to
 * the clipboard and briefly swaps the text to ` copied ` for ~800 ms.
 * The error variant stays inert — there's nothing useful to copy.
 *
 * `eq()` makes equal-content widgets DOM-stable so the in-flight
 * "copied" state survives unrelated editor updates.
 */
const COPIED_REVERT_MS = 800;

class FormulaPreviewWidget extends WidgetType {
  constructor(
    private text: string,
    private isError: boolean,
  ) {
    super();
  }

  override toDOM() {
    const span = document.createElement("span");
    span.className = this.isError ? "cm-formula-preview cm-formula-preview-error" : "cm-formula-preview";
    span.textContent = ` → ${this.text} `;

    // Errors aren't copyable — no sensible value to put on the clipboard.
    if (this.isError) return span;

    const valueText = this.text;
    let revertTimer: number | null = null;

    // mousedown: we own the event. preventDefault stops CM from moving
    // the cursor to the click position; stopPropagation keeps our DOM
    // click handler reachable without CM also processing it.
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    span.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Fire-and-forget — clipboard errors (e.g. permission denied)
      // are silent; the user sees no "copied" flash and will retry.
      clipboard.copy(valueText).then(() => {
        span.textContent = " copied ";
        span.classList.add("cm-formula-preview-copied");
        if (revertTimer !== null) window.clearTimeout(revertTimer);
        revertTimer = window.setTimeout(() => {
          span.textContent = ` → ${valueText} `;
          span.classList.remove("cm-formula-preview-copied");
          revertTimer = null;
        }, COPIED_REVERT_MS);
      }).catch(() => {});
    });

    return span;
  }

  override eq(other: WidgetType) {
    return other instanceof FormulaPreviewWidget && other.text === this.text && other.isError === this.isError;
  }

  override ignoreEvent() {
    return true;
  }
}

/** Split a table source line into cell ranges (positions within the
 *  line). Tracks the offset of each cell's content so the live-preview
 *  decoration can be placed precisely just before the cell-closing
 *  `|` (or end of line for the last cell). */
type CellRange = { fromInLine: number; toInLine: number; text: string };

const splitTableLineCells = (lineText: string): CellRange[] => {
  const ranges: CellRange[] = [];
  let cellStart = lineText.startsWith("|") ? 1 : 0;
  for (let i = cellStart; i < lineText.length; i++) {
    if (lineText[i] === "|") {
      ranges.push({ fromInLine: cellStart, toInLine: i, text: lineText.slice(cellStart, i) });
      cellStart = i + 1;
    }
  }
  // Trailing cell when the row doesn't end with `|`
  if (cellStart < lineText.length) {
    ranges.push({ fromInLine: cellStart, toInLine: lineText.length, text: lineText.slice(cellStart) });
  }
  return ranges;
};

/** Build inline live-preview decorations for one table when its
 *  source is visible. Walks each body line, parses cell positions,
 *  evaluates any `=...` cells, and inserts a `Decoration.widget` at
 *  the cell-end position so it floats next to the literal source. */
const buildLivePreviewDecorations = (
  state: EditorState,
  tableNode: { from: number; to: number },
  data: TableData,
): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const startLine = state.doc.lineAt(tableNode.from);
  const endLine = state.doc.lineAt(tableNode.to);
  // Lines: [0]=header, [1]=separator, [2..]=body rows
  for (let lineNum = startLine.number + 2; lineNum <= endLine.number; lineNum++) {
    const line = state.doc.line(lineNum);
    const bodyRowIdx = lineNum - startLine.number - 2;
    if (bodyRowIdx < 0 || bodyRowIdx >= data.rows.length) continue;
    const cells = splitTableLineCells(line.text);
    cells.forEach((cell, colIdx) => {
      if (colIdx >= data.headers.length) return;
      const trimmed = cell.text.trim();
      if (!isFormula(trimmed)) return;
      const ctx: EvalContext = {
        headers: data.headers,
        rows: data.rows,
        currentRow: bodyRowIdx,
        currentCol: colIdx,
      };
      const result = evaluateFormula(trimmed, ctx);
      const previewText = result.kind === "ok" ? formatValue(result.value) : `⚠ ${result.message.split("\n")[0]}`;
      decorations.push(
        Decoration.widget({
          widget: new FormulaPreviewWidget(previewText, result.kind === "error"),
          side: 1,
        }).range(line.from + cell.toInLine),
      );
    });
  }
  return decorations;
};

/**
 * Tile-style table preview. Click → dispatches cursor to the table's
 * start (`fromPos`, captured at decoration time) so the source-show
 * range fires and the user can edit inline.
 *
 * The click handler lives on the widget DOM, not in a view-level
 * `mousedown`, because `view.posAtDOM(target)` falls back to
 * `state.doc.length` for nodes inside a `contenteditable=false` widget
 * — that fallback was the cause of the "click jumps to end of doc" bug.
 * Capturing the start position at construction sidesteps the problem.
 */
class TableWidget extends WidgetType {
  constructor(
    private data: TableData,
    private fromPos: number,
  ) {
    super();
  }

  override toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-table-widget";
    container.setAttribute("contenteditable", "false");
    container.innerHTML = renderTable(this.data);
    container.onmousedown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.fromPos } });
      view.focus();
    };
    return container;
  }

  override eq(other: WidgetType) {
    return (
      other instanceof TableWidget &&
      other.fromPos === this.fromPos &&
      JSON.stringify(this.data) === JSON.stringify(other.data)
    );
  }

  /** Widget handles its own clicks; keep CM's view-level handlers off
   *  this DOM tree so the click never reaches `posAtDOM`. */
  override ignoreEvent() {
    return true;
  }

  override get estimatedHeight() {
    return (this.data.rows.length + 1) * 36 + 16;
  }
}

const findMarkdownTables = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const cursor = state.selection.ranges[0]!;

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.name !== "Table") return;

      const text = state.sliceDoc(node.from, node.to);
      const data = parseTable(text);
      if (!data || data.headers.length === 0) return;

      // Show-source range: when the cursor is anywhere inside the table
      // OR on the line right after it, drop the block widget so the
      // raw markdown becomes editable. Instead, slip in inline live-
      // preview decorations after each formula cell — the user sees
      // their `=hours * rate` followed by ` → 160` ghost text and can
      // verify the result while still typing in the source.
      const nextLine = state.doc.lineAt(Math.min(node.to + 1, state.doc.length));
      const sourceVisible = cursor.from >= node.from && cursor.to <= nextLine.to;
      if (sourceVisible) {
        for (const deco of buildLivePreviewDecorations(state, { from: node.from, to: node.to }, data)) {
          decorations.push(deco);
        }
        return false;
      }

      decorations.push(
        Decoration.replace({
          widget: new TableWidget(data, node.from),
          block: true,
        }).range(node.from, node.to),
      );
    },
  });

  return decorations;
};

export const tablesExtension = (): Extension => {
  const stateField = StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(findMarkdownTables(state), true);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return RangeSet.of(findMarkdownTables(tr.state), true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const theme = EditorView.theme({
    ".cm-table-widget": {
      display: "block",
      margin: "0 !important",
      lineHeight: "1",
    },
  });

  // No view-level mousedown handler — the widget's own onmousedown
  // captures the click + stopPropagation prevents CM's internal
  // logic from running posAtDOM against widget-DOM targets.
  return [stateField, theme];
};
