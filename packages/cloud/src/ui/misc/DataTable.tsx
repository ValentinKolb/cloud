import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";

export type DataTableColumn<T> = {
  id: string;
  header: JSX.Element | ((ctx: { col: DataTableColumn<T> }) => JSX.Element);
  subtitle?: JSX.Element | ((ctx: { col: DataTableColumn<T> }) => JSX.Element);
  value?: keyof T | ((row: T) => unknown);
  class?: string;
  headerClass?: string;
  cellClass?: string;
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
  renderCell?: DataTableRenderCell<T>;
  renderHeader?: DataTableRenderHeader<T>;
  footer?: DataTableFooter<T>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  empty?: JSX.Element;
  density?: "compact" | "normal";
  stickyHeader?: boolean;
  cellContentClass?: string;
  fillHeight?: boolean;
  class?: string;
  tableClass?: string;
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
  const rowId = (row: T) => props.getRowId?.(row);
  const isInteractive = () => !!props.onRowClick;
  const shouldHoverRows = () => props.hoverRows ?? isInteractive();
  const shouldRenderLoadMoreSentinel = () => !!props.onLoadMore;
  const cellPadding = () => (props.density === "compact" ? "px-3 py-1.5" : "px-3 py-2");
  const headerPadding = () => (props.density === "compact" ? "px-3 py-1.5" : "px-3 py-2");
  const cellContentClass = () => props.cellContentClass ?? "truncate";
  const tableClass = () => props.tableClass ?? `w-full text-xs ${props.fillHeight ? "h-full" : ""}`;
  const columnHoverClass = (index: number) =>
    shouldHoverRows() && hoveredColumn() === index ? "bg-zinc-950/[0.015] dark:bg-black/[0.12]" : "";
  const setHoveredColumnIfEnabled = (index: number) => {
    if (shouldHoverRows()) setHoveredColumn(index);
  };

  const isNearBottom = () => {
    if (!scrollRef) return false;
    return scrollRef.scrollTop + scrollRef.clientHeight >= scrollRef.scrollHeight - 240;
  };

  const maybeLoadMore = () => {
    if (!props.hasMore || props.loadingMore || !props.onLoadMore) return;
    if (!isNearBottom()) return;
    props.onLoadMore();
  };

  const valueOf = (row: T, col: DataTableColumn<T>) => {
    if (typeof col.value === "function") return col.value(row);
    if (col.value) return row[col.value];
    return undefined;
  };

  const renderHeaderDefault = (col: DataTableColumn<T>): JSX.Element => (
    <div class="flex flex-col gap-0.5 leading-tight">
      <span class="text-primary font-semibold">{renderColumnPart(col.header, col)}</span>
      <Show when={col.subtitle !== undefined}>
        <span class="text-[10px] text-dimmed font-normal">{renderColumnPart(col.subtitle, col)}</span>
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
    props.hasMore;
    props.loadingMore;
    queueMicrotask(maybeLoadMore);
  });

  return (
    <Show when={props.columns.length > 0} fallback={<div class="paper p-6 text-center text-sm text-dimmed">No columns.</div>}>
      <div
        ref={scrollRef}
        role="region"
        aria-label="Data table"
        class={props.class ?? "paper overflow-auto flex-1 min-h-0"}
        onScroll={maybeLoadMore}
        onMouseLeave={() => setHoveredColumn(null)}
      >
        <table class={tableClass()}>
          <thead class={props.stickyHeader === false ? undefined : "sticky top-0 z-10 bg-white dark:bg-zinc-900"}>
            <tr class="border-b border-zinc-100 dark:border-zinc-800">
              <For each={props.columns}>
                {(col, index) => (
                  <th
                    class={`${headerPadding()} text-left ${columnHoverClass(index())} ${col.headerClass ?? ""} ${col.class ?? ""}`}
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
              <tfoot class="sticky bottom-0 z-10 bg-white dark:bg-zinc-900">
                <tr class="border-t border-zinc-100 dark:border-zinc-800">
                  <For each={props.columns}>
                    {(col, index) => {
                      const value = () => footer().values?.[col.id];
                      return (
                        <td
                          class={`px-3 py-1.5 text-[11px] text-dimmed ${columnHoverClass(index())}`}
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
                  <td class="px-3 py-6 text-center text-xs text-dimmed" colspan={props.columns.length}>
                    {props.empty ?? "No records"}
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
                      class={`border-b border-zinc-100 dark:border-zinc-800/60 last:border-0 ${
                        shouldHoverRows() ? `${isInteractive() ? "cursor-pointer" : ""} hover:bg-zinc-200/55 dark:hover:bg-zinc-800/50` : ""
                      } ${isSelected() ? "bg-blue-50 dark:bg-blue-900/20" : ""} ${rowClass(row)}`}
                      tabIndex={isInteractive() ? 0 : undefined}
                      onClick={() => props.onRowClick?.(row)}
                      onKeyDown={(e) => onRowKeyDown(e, row)}
                    >
                      <For each={props.columns}>
                        {(col, index) => {
                          const value = () => valueOf(row, col);
                          return (
                            <td
                              class={`${cellPadding()} align-top max-w-[260px] ${columnHoverClass(index())} ${col.cellClass ?? ""} ${col.class ?? ""}`}
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
