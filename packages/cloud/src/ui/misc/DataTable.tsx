import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import Placeholder from "./Placeholder";

export type DataTableColumn<T> = {
  id: string;
  header: JSX.Element | ((ctx: { col: DataTableColumn<T> }) => JSX.Element);
  subtitle?: JSX.Element | ((ctx: { col: DataTableColumn<T> }) => JSX.Element);
  value?: keyof T | ((row: T) => unknown);
  class?: string;
  headerClass?: string;
  cellClass?: string;
  /** Defaults to right for numeric values and left for everything else. */
  align?: "left" | "center" | "right";
};

export type DataTableRenderCell<T> = (ctx: {
  row: T;
  col: DataTableColumn<T>;
  value: unknown;
  render: (value: unknown) => JSX.Element;
}) => JSX.Element;

export type DataTableRenderHeader<T> = (ctx: { col: DataTableColumn<T>; render: () => JSX.Element }) => JSX.Element;

export type DataTableFooter<T> = {
  values?: Record<string, unknown>;
  renderCell?: (ctx: { col: DataTableColumn<T>; value: unknown; render: (value: unknown) => JSX.Element }) => JSX.Element;
};

export type DataTableProps<T> = {
  rows: readonly T[];
  columns: readonly DataTableColumn<T>[];
  getRowId?: (row: T) => string;
  selectedRowId?: string | null;
  rowClass?: string | ((row: T) => string | undefined);
  hoverRows?: boolean;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  renderCell?: DataTableRenderCell<T>;
  renderHeader?: DataTableRenderHeader<T>;
  footer?: DataTableFooter<T>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  empty?: JSX.Element;
  density?: "compact" | "normal";
  stickyHeader?: boolean;
  highlightColumns?: boolean;
  verticalAlign?: "top" | "middle" | "bottom";
  cellContentClass?: string;
  fillHeight?: boolean;
  class?: string;
  tableClass?: string;
  scrollPreserveKey?: string | false;
};

const defaultRender = (value: unknown): JSX.Element => {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const renderColumnPart = <T,>(
  part: DataTableColumn<T>["header"] | DataTableColumn<T>["subtitle"],
  col: DataTableColumn<T>,
): JSX.Element => {
  if (typeof part === "function") return part({ col });
  return part;
};

export default function DataTable<T>(props: DataTableProps<T>) {
  const [hoveredColumn, setHoveredColumn] = createSignal<number | null>(null);
  let scrollRef: HTMLDivElement | undefined;
  let loadMoreRef: HTMLDivElement | undefined;
  let hasMore = false;
  let loadingMore = false;
  let onLoadMore: (() => void) | undefined;
  const rowId = (row: T) => props.getRowId?.(row);
  const isInteractive = () => !!props.onRowClick || !!props.onRowDoubleClick;
  const shouldHoverRows = () => props.hoverRows ?? isInteractive();
  const shouldRenderLoadMoreSentinel = () => !!props.onLoadMore;
  const cellPadding = () => (props.density === "compact" ? "px-3 py-1.5" : "px-3 py-2");
  const headerPadding = () => (props.density === "compact" ? "px-3 py-1.5" : "px-3 py-2");
  const cellContentClass = () => props.cellContentClass ?? "truncate";
  const cellVerticalAlignClass = () =>
    props.verticalAlign === "top" ? "align-top" : props.verticalAlign === "bottom" ? "align-bottom" : "align-middle";
  const tableClass = () => props.tableClass ?? `w-full text-xs ${props.fillHeight ? "h-full" : ""}`;
  const columnHoverClass = (index: number) =>
    props.highlightColumns !== false && shouldHoverRows() && hoveredColumn() === index ? "data-table-column-hover" : "";
  const setHoveredColumnIfEnabled = (index: number) => {
    if (shouldHoverRows()) setHoveredColumn(index);
  };

  const isNearBottom = () => {
    if (!scrollRef) return false;
    return scrollRef.scrollTop + scrollRef.clientHeight >= scrollRef.scrollHeight - 240;
  };

  const maybeLoadMore = () => {
    if (!hasMore || loadingMore || !onLoadMore) return;
    if (!isNearBottom()) return;
    onLoadMore();
  };

  const valueOf = (row: T, col: DataTableColumn<T>) => {
    if (typeof col.value === "function") return col.value(row);
    if (col.value) return row[col.value];
    return undefined;
  };

  const columnAlign = (col: DataTableColumn<T>) => {
    if (col.align) return col.align;
    for (const row of props.rows) {
      const value = valueOf(row, col);
      if (value === null || value === undefined || value === "") continue;
      return typeof value === "number" || typeof value === "bigint" ? "right" : "left";
    }
    return "left";
  };

  const alignmentClass = (col: DataTableColumn<T>) => {
    const align = columnAlign(col);
    return align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  };

  const headerAlignmentClass = (col: DataTableColumn<T>) => {
    const align = columnAlign(col);
    return align === "right" ? "items-end text-right" : align === "center" ? "items-center text-center" : "items-start text-left";
  };

  const renderHeaderDefault = (col: DataTableColumn<T>): JSX.Element => (
    <div class={`flex flex-col gap-0.5 leading-tight ${headerAlignmentClass(col)}`}>
      <span class="text-primary font-semibold">{renderColumnPart(col.header, col)}</span>
      <Show when={col.subtitle !== undefined}>
        <span class="text-[11px] text-dimmed font-normal">{renderColumnPart(col.subtitle, col)}</span>
      </Show>
    </div>
  );

  const renderCellDefault = (row: T, col: DataTableColumn<T>) => defaultRender(valueOf(row, col));

  const onRowKeyDown = (event: KeyboardEvent, row: T) => {
    if (!isInteractive()) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onRowClick?.(row);
  };

  const rowClass = (row: T) => {
    if (typeof props.rowClass === "function") return props.rowClass(row) ?? "";
    return props.rowClass ?? "";
  };

  onMount(() => {
    if (typeof IntersectionObserver === "undefined" || !scrollRef || !loadMoreRef) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) maybeLoadMore();
      },
      { root: scrollRef, rootMargin: "240px" },
    );
    observer.observe(loadMoreRef);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    props.rows.length;
    hasMore = !!props.hasMore;
    loadingMore = !!props.loadingMore;
    onLoadMore = props.onLoadMore;
    maybeLoadMore();
  });

  return (
    <Show when={props.columns.length > 0} fallback={<Placeholder surface="paper">No columns.</Placeholder>}>
      <div
        ref={scrollRef}
        role="region"
        aria-label="Data table"
        class={props.class ?? "paper overflow-auto flex-1 min-h-0"}
        data-scroll-preserve={props.scrollPreserveKey || undefined}
        onScroll={maybeLoadMore}
        onMouseLeave={() => setHoveredColumn(null)}
      >
        <table class={tableClass()}>
          <thead class={props.stickyHeader === false ? undefined : "data-table-header sticky top-0 z-10"}>
            <tr class="data-table-divider border-b">
              <For each={props.columns}>
                {(col, index) => (
                  <th
                    class={`${headerPadding()} ${alignmentClass(col)} ${columnHoverClass(index())} ${col.headerClass ?? ""} ${col.class ?? ""}`}
                    onMouseEnter={() => setHoveredColumnIfEnabled(index())}
                  >
                    {props.renderHeader ? props.renderHeader({ col, render: () => renderHeaderDefault(col) }) : renderHeaderDefault(col)}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <Show when={props.footer}>
            {(footer) => (
              <tfoot class="data-table-header sticky bottom-0 z-10">
                <tr class="data-table-divider border-t">
                  <For each={props.columns}>
                    {(col, index) => {
                      const value = () => footer().values?.[col.id];
                      return (
                        <td
                          class={`px-3 py-1.5 text-[11px] text-dimmed ${alignmentClass(col)} ${columnHoverClass(index())}`}
                          onMouseEnter={() => setHoveredColumnIfEnabled(index())}
                        >
                          {footer().renderCell
                            ? footer().renderCell!({ col, value: value(), render: defaultRender })
                            : defaultRender(value())}
                        </td>
                      );
                    }}
                  </For>
                </tr>
              </tfoot>
            )}
          </Show>
          <tbody>
            <Show
              when={props.rows.length > 0}
              fallback={
                <tr>
                  <td class="p-0" colspan={props.columns.length}>
                    <Placeholder>{props.empty ?? "No records"}</Placeholder>
                  </td>
                </tr>
              }
            >
              <For each={props.rows}>
                {(row) => {
                  const id = () => rowId(row);
                  const isSelected = () => props.selectedRowId && id() === props.selectedRowId;
                  return (
                    <tr
                      class={`data-table-row-divider border-b last:border-0 ${
                        shouldHoverRows() ? `${isInteractive() ? "cursor-pointer" : ""} data-table-row-hover` : ""
                      } ${isSelected() ? "data-table-row-selected" : ""} ${rowClass(row)}`}
                      tabIndex={isInteractive() ? 0 : undefined}
                      onClick={() => props.onRowClick?.(row)}
                      onDblClick={() => props.onRowDoubleClick?.(row)}
                      onKeyDown={(e) => onRowKeyDown(e, row)}
                    >
                      <For each={props.columns}>
                        {(col, index) => {
                          const value = () => valueOf(row, col);
                          return (
                            <td
                              class={`${cellPadding()} ${cellVerticalAlignClass()} ${alignmentClass(col)} max-w-[260px] ${columnHoverClass(index())} ${col.cellClass ?? ""} ${col.class ?? ""}`}
                              onMouseEnter={() => setHoveredColumnIfEnabled(index())}
                            >
                              <div class={cellContentClass()}>
                                {props.renderCell
                                  ? props.renderCell({
                                      row,
                                      col,
                                      value: value(),
                                      render: (v) => renderCellDefault(row, { ...col, value: () => v }),
                                    })
                                  : defaultRender(value())}
                              </div>
                            </td>
                          );
                        }}
                      </For>
                    </tr>
                  );
                }}
              </For>
              <Show when={props.fillHeight}>
                <tr aria-hidden="true">
                  <td class="h-full p-0" colspan={props.columns.length} />
                </tr>
              </Show>
            </Show>
          </tbody>
        </table>
        <Show when={shouldRenderLoadMoreSentinel()}>
          <div ref={loadMoreRef} class="h-1" aria-hidden="true" />
        </Show>
      </div>
    </Show>
  );
}
