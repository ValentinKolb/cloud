import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";

export type DataTableAlign = "left" | "center" | "right";
export type DataTableSort = { key: string; direction: "asc" | "desc" };
export type DataTableColumn<T> = {
  id: string;
  header: JSX.Element | ((column: DataTableColumn<T>) => JSX.Element);
  subtitle?: JSX.Element | ((column: DataTableColumn<T>) => JSX.Element);
  value?: keyof T | ((row: T) => unknown);
  align?: DataTableAlign;
  sortable?: boolean | string;
  class?: string;
  headerClass?: string;
  cellClass?: string;
};

export type DataTableFooter<T> = {
  values?: Record<string, unknown>;
  renderCell?: (context: {
    column: DataTableColumn<T>;
    value: unknown;
    render: (value: unknown) => JSX.Element;
  }) => JSX.Element;
};

export type DataTableProps<T> = {
  rows: readonly T[];
  columns: readonly DataTableColumn<T>[];
  getRowId?: (row: T) => string;
  sort?: DataTableSort | null;
  sortHref?: (sort: DataTableSort) => string;
  onSort?: (sort: DataTableSort) => void;
  selectedRowId?: string | null;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  rowClass?: string | ((row: T) => string | undefined);
  renderCell?: (context: {
    row: T;
    column: DataTableColumn<T>;
    value: unknown;
    render: (value: unknown) => JSX.Element;
  }) => JSX.Element;
  renderHeader?: (context: {
    column: DataTableColumn<T>;
    render: () => JSX.Element;
  }) => JSX.Element;
  empty?: JSX.Element;
  footer?: DataTableFooter<T>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  density?: "compact" | "normal";
  stickyHeader?: boolean;
  stickyFooter?: boolean;
  hoverRows?: boolean;
  highlightColumns?: boolean;
  verticalAlign?: "top" | "middle" | "bottom";
  fillHeight?: boolean;
  ariaLabel?: string;
  class?: string;
  tableClass?: string;
};

export const renderDataTableValue = (value: unknown): JSX.Element => {
  if (value === null || value === undefined || value === "") {
    return (
      <span>
        <span class="k2b-visually-hidden">No value</span>—
      </span>
    );
  }
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") return String(value);
  return JSON.stringify(value);
};

const columnPart = <T,>(
  part: DataTableColumn<T>["header"] | DataTableColumn<T>["subtitle"],
  column: DataTableColumn<T>,
): JSX.Element => (typeof part === "function" ? part(column) : part);

export function DataTable<T>(props: DataTableProps<T>): JSX.Element {
  let scrollRoot: HTMLDivElement | undefined;
  let loadMoreTarget: HTMLDivElement | undefined;
  let canLoadMore = false;
  let loadingMore = false;
  let loadMore: (() => void) | undefined;
  const [hoveredColumn, setHoveredColumn] = createSignal<number | null>(null);
  const interactiveRows = () => !!props.onRowClick || !!props.onRowDoubleClick;
  const hoverRows = () => props.hoverRows ?? interactiveRows();
  const valueOf = (row: T, column: DataTableColumn<T>) =>
    typeof column.value === "function" ? column.value(row) : column.value ? row[column.value] : undefined;
  const alignment = (column: DataTableColumn<T>): DataTableAlign => {
    if (column.align) return column.align;
    const first = props.rows.map((row) => valueOf(row, column)).find((value) => value !== null && value !== undefined && value !== "");
    return typeof first === "number" || typeof first === "bigint" ? "right" : "left";
  };
  const sortKey = (column: DataTableColumn<T>) =>
    column.sortable === true ? column.id : typeof column.sortable === "string" ? column.sortable : null;
  const nextSort = (column: DataTableColumn<T>): DataTableSort | null => {
    const key = sortKey(column);
    if (!key) return null;
    return { key, direction: props.sort?.key === key && props.sort.direction === "asc" ? "desc" : "asc" };
  };
  const ariaSort = (column: DataTableColumn<T>): "ascending" | "descending" | "none" | undefined => {
    if (!sortKey(column)) return undefined;
    if (props.sort?.key !== sortKey(column)) return "none";
    return props.sort.direction === "asc" ? "ascending" : "descending";
  };
  const header = (column: DataTableColumn<T>) => {
    const content = (
      <span class="k2b-data-table__header-content">
        <span>{columnPart(column.header, column)}</span>
        <Show when={column.subtitle !== undefined}>
          <small>{columnPart(column.subtitle, column)}</small>
        </Show>
        <Show when={sortKey(column)}>
          <i
            class={`ti ${props.sort?.key === sortKey(column) && props.sort.direction === "asc" ? "ti-arrow-up" : "ti-arrow-down"}`}
            data-active={props.sort?.key === sortKey(column) ? "true" : undefined}
            aria-hidden="true"
          />
        </Show>
      </span>
    );
    const next = nextSort(column);
    if (!next) return content;
    if (props.sortHref) return <a href={props.sortHref(next)}>{content}</a>;
    if (props.onSort) return <button type="button" onClick={() => props.onSort?.(next)}>{content}</button>;
    return content;
  };
  const rowClass = (row: T) => (typeof props.rowClass === "function" ? props.rowClass(row) ?? "" : props.rowClass ?? "");
  const maybeLoadMore = () => {
    if (!scrollRoot || !canLoadMore || loadingMore || !loadMore) return;
    if (scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 240) loadMore();
  };

  onMount(() => {
    if (typeof IntersectionObserver === "undefined" || !scrollRoot || !loadMoreTarget) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && maybeLoadMore(), {
      root: scrollRoot,
      rootMargin: "240px",
    });
    observer.observe(loadMoreTarget);
    onCleanup(() => observer.disconnect());
  });
  createEffect(() => {
    props.rows.length;
    canLoadMore = !!props.hasMore;
    loadingMore = !!props.loadingMore;
    loadMore = props.onLoadMore;
    maybeLoadMore();
  });

  return (
    <Show
      when={props.columns.length > 0}
      fallback={<div class="k2b-data-table__empty" role="status">No columns</div>}
    >
      <div
        ref={scrollRoot}
        class={`k2b-table-wrap ${props.class ?? ""}`}
        data-density={props.density ?? "normal"}
        role="region"
        aria-label={props.ariaLabel ?? "Data table"}
        onScroll={maybeLoadMore}
        onMouseLeave={() => setHoveredColumn(null)}
      >
        <table class={`k2b-data-table ${props.tableClass ?? ""}`} data-fill={props.fillHeight ? "true" : undefined}>
          <thead data-sticky={props.stickyHeader === false ? undefined : "true"}>
            <tr>
              <For each={props.columns}>
                {(column, index) => (
                  <th
                    scope="col"
                    class={`${column.headerClass ?? ""} ${column.class ?? ""}`}
                    data-align={alignment(column)}
                    data-highlighted={props.highlightColumns && hoveredColumn() === index() ? "true" : undefined}
                    aria-sort={ariaSort(column)}
                    onMouseEnter={() => props.highlightColumns && setHoveredColumn(index())}
                  >
                    {props.renderHeader?.({ column, render: () => header(column) }) ?? header(column)}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For
              each={props.rows}
              fallback={
                <tr>
                  <td class="k2b-data-table__empty" colspan={props.columns.length}>{props.empty ?? "No records"}</td>
                </tr>
              }
            >
              {(row) => {
                const id = () => props.getRowId?.(row);
                return (
                  <tr
                    class={rowClass(row)}
                    data-selected={id() && props.selectedRowId === id() ? "true" : undefined}
                    data-clickable={interactiveRows() ? "true" : undefined}
                    data-hover={hoverRows() ? "true" : undefined}
                    tabindex={interactiveRows() ? 0 : undefined}
                    onClick={() => props.onRowClick?.(row)}
                    onDblClick={() => props.onRowDoubleClick?.(row)}
                    onKeyDown={(event) => {
                      if (!interactiveRows() || (event.key !== "Enter" && event.key !== " ")) return;
                      event.preventDefault();
                      props.onRowClick?.(row);
                    }}
                  >
                    <For each={props.columns}>
                      {(column, index) => {
                        const value = () => valueOf(row, column);
                        return (
                          <td
                            class={`${column.cellClass ?? ""} ${column.class ?? ""}`}
                            data-align={alignment(column)}
                            data-valign={props.verticalAlign ?? "middle"}
                            data-highlighted={props.highlightColumns && hoveredColumn() === index() ? "true" : undefined}
                            onMouseEnter={() => props.highlightColumns && setHoveredColumn(index())}
                          >
                            {props.renderCell?.({
                              row,
                              column,
                              value: value(),
                              render: renderDataTableValue,
                            }) ?? renderDataTableValue(value())}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                );
              }}
            </For>
            <Show when={props.fillHeight && props.rows.length > 0}>
              <tr aria-hidden="true"><td class="k2b-data-table__fill" colspan={props.columns.length} /></tr>
            </Show>
          </tbody>
          <Show when={props.footer}>
            {(footer) => (
              <tfoot data-sticky={props.stickyFooter ? "true" : undefined}>
                <tr>
                  <For each={props.columns}>
                    {(column) => {
                      const value = () => footer().values?.[column.id];
                      return (
                        <td data-align={alignment(column)}>
                          {footer().renderCell?.({ column, value: value(), render: renderDataTableValue }) ??
                            renderDataTableValue(value())}
                        </td>
                      );
                    }}
                  </For>
                </tr>
              </tfoot>
            )}
          </Show>
        </table>
        <Show when={props.onLoadMore}>
          <div ref={loadMoreTarget} class="k2b-data-table__sentinel" aria-hidden="true" />
          <Show when={props.loadingMore}>
            <p class="k2b-data-table__loading" role="status">Loading more…</p>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
