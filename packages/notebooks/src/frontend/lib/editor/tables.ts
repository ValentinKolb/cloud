import { syntaxTree } from "@codemirror/language";
import { StateField, RangeSet, EditorState, type Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { dates } from "@valentinkolb/stdlib";
import dayjs from "dayjs";

type TableData = {
  headers: string[];
  rows: string[][];
};

const parseAndFormatTable = (text: string): TableData | null => {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return null;

  const allRows = lines.map((line) => {
    const trimmed = line.trim();
    return trimmed
      .split("|")
      .map((cell) => cell.trim())
      .filter((_, i, arr) => {
        return !((i === 0 && trimmed.startsWith("|")) || (i === arr.length - 1 && trimmed.endsWith("|")));
      });
  });

  if (!lines[1]?.includes("---")) return null;

  const headers = allRows[0] ?? [];
  const rows = allRows.slice(2);

  const columnCount = headers.length;
  const normalizedRows = rows.map((row) => {
    while (row.length < columnCount) row.push("");
    return row.slice(0, columnCount);
  });

  return { headers, rows: normalizedRows };
};

export function createTable(data: { headers: string[]; rows: unknown[][] }, perPage: number = 20): HTMLElement {
  const container = document.createElement("div");
  container.className = "flex flex-col";

  const tableContentArea = document.createElement("div");
  tableContentArea.className = "table-content-area";

  const paginationArea = document.createElement("div");
  paginationArea.className = "pagination-area mt-2";
  paginationArea.setAttribute("data-ignore-click", "true");

  let currentPage = 1;
  const rowCount = data.rows.length;
  const maxPage = Math.ceil(rowCount / perPage);

  let tbody: HTMLTableSectionElement;
  let pageIndicator: HTMLElement | null = null;
  let prevBtn: HTMLButtonElement | null = null;
  let nextBtn: HTMLButtonElement | null = null;

  const formatCell = (cell: unknown): string => {
    if (cell === null) return '<span class="text-gray-400 italic">NULL</span>';
    if (cell === undefined) return '<span class="text-gray-400 italic">---</span>';
    if (typeof cell === "boolean") return `<span class="${cell ? "text-green-600" : "text-red-600"}">${cell}</span>`;
    if (typeof cell === "number" && !Number.isInteger(cell)) return cell.toFixed(4).replace(/\.?0+$/, "");
    if (
      cell instanceof Date ||
      (typeof cell === "object" && cell && dayjs.isDayjs(cell)) ||
      (typeof cell === "string" && cell.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/))
    ) {
      return dates.formatDateTime(dayjs.isDayjs(cell) ? cell.toDate() : (cell as Date | string));
    }
    return String(cell);
  };

  const generateRowsHtml = (rows: unknown[][]): string => {
    return rows
      .map(
        (row) =>
          `<tr class="hover:font-semibold">
          ${row
            .map(formatCell)
            .map((s, i) => ({
              cell: s,
              cls: i % 2 === 0 ? "bg-gray-50 dark:bg-gray-800/20" : "",
            }))
            .map(({ cell, cls }) => `<td class="px-3 py-2 whitespace-nowrap min-w-30 ${cls}">${cell}</td>`)
            .join("")}
        </tr>`,
      )
      .join("");
  };

  const updateTable = (newPage: number): void => {
    currentPage = newPage;
    const start = (currentPage - 1) * perPage;
    const end = start + perPage;
    const pageRows = data.rows.slice(start, end);

    if (tbody) tbody.innerHTML = generateRowsHtml(pageRows);

    if (rowCount > perPage) {
      if (pageIndicator) pageIndicator.textContent = `${currentPage} of ${maxPage} • ${rowCount} rows total`;
      if (prevBtn) prevBtn.disabled = currentPage === 1;
      if (nextBtn) nextBtn.disabled = currentPage === maxPage;
    }
  };

  const headersHtml = data.headers
    .map(
      (h) =>
        `<th class="px-3 py-2 text-left font-medium bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap min-w-30">${h}</th>`,
    )
    .join("");

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "overflow-x-auto rounded";

  const table = document.createElement("table");
  table.className = "min-w-full text-sm tabular-nums";
  table.innerHTML = `<thead><tr>${headersHtml}</tr></thead><tbody class="divide-y divide-gray-200 dark:divide-gray-700"></tbody>`;

  tbody = table.querySelector("tbody") as HTMLTableSectionElement;
  tableWrapper.appendChild(table);
  tableContentArea.appendChild(tableWrapper);
  container.appendChild(tableContentArea);

  if (rowCount > perPage) {
    paginationArea.className += " flex items-center justify-center gap-2";

    prevBtn = document.createElement("button");
    prevBtn.className = "btn-subtle";
    prevBtn.innerHTML = '<i class="ti ti-chevron-left"></i>';
    prevBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (currentPage > 1) updateTable(currentPage - 1);
    };
    paginationArea.appendChild(prevBtn);

    pageIndicator = document.createElement("span");
    pageIndicator.className = "text-xs";
    paginationArea.appendChild(pageIndicator);

    nextBtn = document.createElement("button");
    nextBtn.className = "btn-subtle";
    nextBtn.innerHTML = '<i class="ti ti-chevron-right"></i>';
    nextBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (currentPage < maxPage) updateTable(currentPage + 1);
    };
    paginationArea.appendChild(nextBtn);

    container.appendChild(paginationArea);
  } else {
    paginationArea.className += " text-center text-xs";
    paginationArea.textContent = `${rowCount} row${rowCount === 1 ? "" : "s"}`;
    container.appendChild(paginationArea);
  }

  updateTable(1);
  return container;
}

class TableWidget extends WidgetType {
  private container: HTMLElement | null = null;

  constructor(private tableData: TableData) {
    super();
  }

  override toDOM() {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "cm-table-widget my-2";
      this.container.setAttribute("contenteditable", "false");
      this.container.setAttribute("tabindex", "0");
      this.container.appendChild(createTable(this.tableData, 20));
    }
    return this.container;
  }

  override eq(other: WidgetType) {
    return other instanceof TableWidget && JSON.stringify(this.tableData) === JSON.stringify(other.tableData);
  }

  override ignoreEvent(event: Event) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-ignore-click]")) return true;
    return false;
  }

  override get estimatedHeight() {
    const rows = Math.min(this.tableData.rows.length, 20) + 1;
    return rows * 40 + 80;
  }
}

const findMarkdownTables = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const cursor = state.selection.ranges[0]!;

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.name !== "Table") return;

      const nextLine = state.doc.lineAt(Math.min(node.to + 1, state.doc.length));
      if (cursor.from >= node.from && cursor.to <= nextLine.to) return false;

      const text = state.sliceDoc(node.from, node.to);
      const tableData = parseAndFormatTable(text);

      if (tableData && tableData.headers.length > 0) {
        decorations.push(
          Decoration.replace({
            widget: new TableWidget(tableData),
            block: true,
          }).range(node.from, node.to),
        );
      }
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

  const eventHandlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      if (target.closest("[data-ignore-click]")) return false;
      if (target.closest(".cm-table-widget")) {
        const pos = view.posAtDOM(target);
        if (pos !== null) {
          view.dispatch({ selection: { anchor: pos } });
          return true;
        }
      }
      return false;
    },
  });

  return [stateField, theme, eventHandlers];
};
