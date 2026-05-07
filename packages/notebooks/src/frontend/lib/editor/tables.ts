/**
 * Markdown table widget — renders a `| col | col |` block as a tile-style
 * table when the cursor is on a different line, mirroring the read-mode
 * HTML output served by the `marked` extension. Same `.md-table-*`
 * classes flow through `cloud/src/styles/utilities-table-tile.css` so the
 * visual is identical in edit and read mode.
 *
 * No pagination, no per-cell type detection, no column zebra. Markdown
 * tables are hand-edited and small — those features belong in the Grids
 * app for actual data work.
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

class TableWidget extends WidgetType {
  /**
   * `fromPos` is the document offset where the table starts at the
   * moment the decoration was created. We capture it here so the
   * click handler (below) can dispatch the cursor INTO the widget's
   * source range without going through `posAtDOM` / `posAtCoords` —
   * both fall back to unreliable positions for clicks inside
   * `contenteditable=false` widget DOM (the symptom: cursor jumps to
   * `state.doc.length`). If text is inserted before the table after
   * this widget was created, `fromPos` may drift by a few chars; CM
   * clamps to a valid position, so the cursor lands close enough that
   * the show-source range still fires on the next render tick.
   */
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

    // Click handler at the widget level — same shape as the image and
    // note-link widgets in this package. Stopping propagation also
    // avoids CM's internal mousedown logic running with widget-DOM
    // targets (which is what produces the end-of-doc jump).
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

  /** Widget owns its own click. Tell CM to keep its hands off all
   *  events on this DOM tree so the editor's view-level handlers
   *  don't double-process clicks (which is how `posAtDOM` ends up
   *  being called against widget DOM in the first place). */
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

      // Hide the widget if the cursor is anywhere inside the table — keep
      // the literal markdown source editable. Same pattern as image /
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
