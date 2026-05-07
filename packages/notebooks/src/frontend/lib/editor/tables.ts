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

const renderTable = (data: TableData): string => {
  const headerHtml = data.headers
    .map((h, i) => `<th><span class="md-table-cell${alignClass(data.align[i] ?? null)}">${escapeHtml(h)}</span></th>`)
    .join("");

  const bodyHtml = data.rows
    .map((row) => {
      const cells = row
        .map((cell, i) => `<td><span class="md-table-cell${alignClass(data.align[i] ?? null)}">${escapeHtml(cell)}</span></td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
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

      // Show-source range: when the cursor is anywhere inside the table
      // OR on the line right after it, drop the widget so the raw
      // markdown becomes editable. Same pattern as image / callout /
      // tag-pill widgets.
      const nextLine = state.doc.lineAt(Math.min(node.to + 1, state.doc.length));
      if (cursor.from >= node.from && cursor.to <= nextLine.to) return false;

      const text = state.sliceDoc(node.from, node.to);
      const data = parseTable(text);
      if (!data || data.headers.length === 0) return;

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
