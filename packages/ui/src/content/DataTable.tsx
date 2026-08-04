import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  useContext,
} from "solid-js";
import { PanelHeader } from "../layout/PanelHeader";
import Placeholder from "../surfaces/Placeholder";

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
  /**
   * Marks the column sortable. Pass a string when the server's sort key
   * differs from the column id — they often do, because one column can show a
   * rate while another sorts by the absolute count behind it.
   */
  sortable?: boolean | string;
};

export type DataTableSort = { key: string; direction: "asc" | "desc" };

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
  /** Accessible name for a standalone table region. Defaults to "Data table". */
  ariaLabel?: string;
  /** ID of a visible heading that labels the table region. Takes precedence over ariaLabel. */
  ariaLabelledBy?: string;
  getRowId?: (row: T) => string;
  /** Current server-side ordering, or null when the default applies. */
  sort?: DataTableSort | null;
  /**
   * Link target for a sortable header. Link-based because every admin table is
   * server-rendered: sorting is a query change, not client state.
   */
  sortHref?: (next: DataTableSort) => string;
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
  /** Visual frame for a standalone table. Defaults preserve the legacy class-based behavior. */
  surface?: "paper" | "plain";
  class?: string;
  /** Additional classes for the table element. Core table geometry is always retained. */
  tableClass?: string;
  scrollPreserveKey?: string | false;
};

export type DataTablePanelProps = {
  children: JSX.Element;
  class?: string;
};

export type DataTableHeaderProps = {
  title: string;
  subtitle?: string;
  children?: JSX.Element;
  as?: "h1" | "h2" | "h3";
  size?: "sm" | "md";
  class?: string;
};

export type DataTableControlsProps = {
  children: JSX.Element;
  class?: string;
};

export type DataTablePanelFooterProps = {
  children: JSX.Element;
  class?: string;
};

type DataTablePanelContextValue = {
  headingId: string;
  hasHeading: Accessor<boolean>;
  registerHeading: () => void;
};

const DataTablePanelContext = createContext<DataTablePanelContextValue>();

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

const rowInteractiveSelector = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable]",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[tabindex]",
].join(",");

const isNestedRowControl = (event: Event): boolean =>
  event.target instanceof Element && event.target.closest(rowInteractiveSelector) !== event.currentTarget;

function DataTableRoot<T>(props: DataTableProps<T>) {
  const [hoveredColumn, setHoveredColumn] = createSignal<number | null>(null);
  const panel = useContext(DataTablePanelContext);
  let scrollRef: HTMLDivElement | undefined;
  let loadMoreRef: HTMLDivElement | undefined;
  let hasMore = false;
  let loadingMore = false;
  let onLoadMore: (() => void) | undefined;
  let loadMoreRequested = false;
  let previousRowsLength = props.rows.length;
  let previousLoadingMore = !!props.loadingMore;
  let previousHasMore = !!props.hasMore;
  const rowId = (row: T) => props.getRowId?.(row);
  const isInteractive = () => !!props.onRowClick || !!props.onRowDoubleClick;
  const shouldHoverRows = () => props.hoverRows ?? isInteractive();
  const shouldRenderLoadMoreSentinel = () => !!props.onLoadMore;
  const labelledBy = () => props.ariaLabelledBy ?? (panel?.hasHeading() ? panel.headingId : undefined);
  const cellContentClass = () => props.cellContentClass ?? "k2b-data-table__cell-text";
  const tableClass = () => `k2b-data-table ${props.tableClass ?? ""}`.trim();
  const columnHighlighted = (index: number) =>
    props.highlightColumns !== false && shouldHoverRows() && hoveredColumn() === index ? "true" : undefined;
  const setHoveredColumnIfEnabled = (index: number) => {
    if (shouldHoverRows()) setHoveredColumn(index);
  };

  const isNearBottom = () => {
    if (!scrollRef) return false;
    return scrollRef.scrollTop + scrollRef.clientHeight >= scrollRef.scrollHeight - 240;
  };

  const maybeLoadMore = () => {
    if (!hasMore || loadingMore || loadMoreRequested || !onLoadMore) return;
    if (!isNearBottom()) return;
    loadMoreRequested = true;
    try {
      onLoadMore();
    } catch (error) {
      loadMoreRequested = false;
      throw error;
    }
  };

  const valueOf = (row: T, col: DataTableColumn<T>) => {
    if (typeof col.value === "function") return col.value(row);
    if (col.value) return row[col.value];
    return undefined;
  };

  const columnAlignments = createMemo(() => {
    const alignments = new Map<string, NonNullable<DataTableColumn<T>["align"]>>();
    for (const col of props.columns) {
      if (col.align) {
        alignments.set(col.id, col.align);
        continue;
      }
      let align: NonNullable<DataTableColumn<T>["align"]> = "left";
      for (const row of props.rows) {
        const value = valueOf(row, col);
        if (value === null || value === undefined || value === "") continue;
        align = typeof value === "number" || typeof value === "bigint" ? "right" : "left";
        break;
      }
      alignments.set(col.id, align);
    }
    return alignments;
  });

  /** `data-align` mirrors Cloud's `text-left/center/right` on the same cell. */
  const alignAttr = (col: DataTableColumn<T>) => {
    const align = columnAlignments().get(col.id) ?? "left";
    return align === "left" ? undefined : align;
  };

  const sortKeyOf = (col: DataTableColumn<T>): string | null =>
    col.sortable === true ? col.id : typeof col.sortable === "string" ? col.sortable : null;

  /**
   * Sorting is a link, not a handler: these tables are server-rendered, so the
   * order belongs in the URL. Clicking the active column flips its direction.
   */
  const sortLinkFor = (col: DataTableColumn<T>): { href: string; active: boolean; direction: "asc" | "desc" } | null => {
    const key = sortKeyOf(col);
    if (!key || !props.sortHref) return null;
    const active = props.sort?.key === key;
    const direction: "asc" | "desc" = active && props.sort?.direction === "desc" ? "asc" : "desc";
    return { href: props.sortHref({ key, direction }), active, direction };
  };

  /** Only a sortable column carries a sort state; the rest carry none at all. */
  const ariaSortFor = (col: DataTableColumn<T>): "ascending" | "descending" | "none" | undefined => {
    const sort = sortLinkFor(col);
    if (!sort) return undefined;
    if (!sort.active) return "none";
    return props.sort?.direction === "asc" ? "ascending" : "descending";
  };

  const renderHeaderDefault = (col: DataTableColumn<T>): JSX.Element => {
    const sort = sortLinkFor(col);
    const title = (
      <>
        <span class="k2b-data-table__header-title">{renderColumnPart(col.header, col)}</span>
        <Show when={col.subtitle !== undefined}>
          <span class="k2b-data-table__header-subtitle">{renderColumnPart(col.subtitle, col)}</span>
        </Show>
      </>
    );

    if (!sort)
      return (
        <div class="k2b-data-table__header-content" data-align={alignAttr(col)}>
          {title}
        </div>
      );

    return (
      <a href={sort.href} class="k2b-data-table__header-content k2b-data-table__sort" data-align={alignAttr(col)}>
        <span class="k2b-data-table__header-line">
          {title}
          {/* Inactive columns keep a dimmed marker so the row reads as sortable. */}
          <i
            class={`k2b-data-table__sort-icon ti ${props.sort?.direction === "asc" && sort.active ? "ti-arrow-up" : "ti-arrow-down"}`}
            data-active={sort.active ? "true" : undefined}
            aria-hidden="true"
          />
        </span>
      </a>
    );
  };

  const renderCellDefault = (row: T, col: DataTableColumn<T>) => defaultRender(valueOf(row, col));

  const onRowKeyDown = (event: KeyboardEvent, row: T) => {
    if (!isInteractive()) return;
    if (isNestedRowControl(event)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    (props.onRowClick ?? props.onRowDoubleClick)?.(row);
  };

  const onRowClick = (event: MouseEvent, row: T) => {
    if (isNestedRowControl(event)) return;
    props.onRowClick?.(row);
  };

  const onRowDoubleClick = (event: MouseEvent, row: T) => {
    if (isNestedRowControl(event)) return;
    props.onRowDoubleClick?.(row);
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
    const rowsLength = props.rows.length;
    const nextHasMore = !!props.hasMore;
    const nextLoadingMore = !!props.loadingMore;
    if (
      rowsLength !== previousRowsLength ||
      (previousLoadingMore && !nextLoadingMore) ||
      (!previousHasMore && nextHasMore)
    ) {
      loadMoreRequested = false;
    }
    previousRowsLength = rowsLength;
    previousLoadingMore = nextLoadingMore;
    previousHasMore = nextHasMore;
    hasMore = nextHasMore;
    loadingMore = nextLoadingMore;
    onLoadMore = props.onLoadMore;
    maybeLoadMore();
  });

  return (
    <Show when={props.columns.length > 0} fallback={<Placeholder surface="paper" description={<>No columns.</>} />}>
      <div
        ref={scrollRef}
        role="region"
        aria-label={labelledBy() ? undefined : (props.ariaLabel ?? "Data table")}
        aria-labelledby={labelledBy()}
        tabIndex={0}
        class={`k2b-table-wrap ${props.class ?? ""}`}
        data-density={props.density === "compact" ? "compact" : undefined}
        data-has-footer={props.footer ? "true" : undefined}
        data-surface={props.surface ?? (props.class ? "plain" : "paper")}
        data-scroll-preserve={props.scrollPreserveKey || undefined}
        onScroll={maybeLoadMore}
        onMouseLeave={() => setHoveredColumn(null)}
      >
        <table class={tableClass()} data-fill={props.fillHeight ? "true" : undefined}>
          <thead class="k2b-data-table__head" data-sticky={props.stickyHeader === false ? undefined : "true"}>
            <tr class="k2b-data-table__head-row">
              <For each={props.columns}>
                {(col, index) => (
                  <th
                    scope="col"
                    class={`${col.headerClass ?? ""} ${col.class ?? ""}`}
                    data-align={alignAttr(col)}
                    data-highlighted={columnHighlighted(index())}
                    aria-sort={ariaSortFor(col)}
                    onMouseEnter={() => setHoveredColumnIfEnabled(index())}
                  >
                    {props.renderHeader ? props.renderHeader({ col, render: () => renderHeaderDefault(col) }) : renderHeaderDefault(col)}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <Show
              when={props.rows.length > 0}
              fallback={
                <tr>
                  <td class="k2b-data-table__empty" colspan={props.columns.length}>
                    <Placeholder description={<>{props.empty ?? "No records"}</>} />
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
                      class={`k2b-data-table__row ${rowClass(row)}`}
                      data-hover={shouldHoverRows() ? "true" : undefined}
                      data-clickable={shouldHoverRows() && isInteractive() ? "true" : undefined}
                      data-selected={isSelected() ? "true" : undefined}
                      tabIndex={isInteractive() ? 0 : undefined}
                      onClick={(event) => onRowClick(event, row)}
                      onDblClick={(event) => onRowDoubleClick(event, row)}
                      onKeyDown={(e) => onRowKeyDown(e, row)}
                    >
                      <For each={props.columns}>
                        {(col, index) => {
                          const value = () => valueOf(row, col);
                          return (
                            <td
                              class={`${col.cellClass ?? ""} ${col.class ?? ""}`}
                              data-align={alignAttr(col)}
                              data-valign={props.verticalAlign && props.verticalAlign !== "middle" ? props.verticalAlign : undefined}
                              data-highlighted={columnHighlighted(index())}
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
                  <td class="k2b-data-table__fill" colspan={props.columns.length} />
                </tr>
              </Show>
            </Show>
          </tbody>
          <Show when={props.footer}>
            {(footer) => (
              <tfoot class="k2b-data-table__foot" data-sticky="true">
                <tr class="k2b-data-table__foot-row">
                  <For each={props.columns}>
                    {(col, index) => {
                      const value = () => footer().values?.[col.id];
                      return (
                        <td
                          class="k2b-data-table__footer-cell"
                          data-align={alignAttr(col)}
                          data-highlighted={columnHighlighted(index())}
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
        </table>
        <Show when={shouldRenderLoadMoreSentinel()}>
          <div ref={loadMoreRef} class="k2b-data-table__sentinel" aria-hidden="true" />
        </Show>
      </div>
    </Show>
  );
}

const DataTablePanel = (props: DataTablePanelProps): JSX.Element => {
  const headingId = `k2b-data-table-${createUniqueId()}-heading`;
  const [hasHeading, setHasHeading] = createSignal(false);
  const context: DataTablePanelContextValue = {
    headingId,
    hasHeading,
    registerHeading: () => setHasHeading(true),
  };

  return (
    <DataTablePanelContext.Provider value={context}>
      <section class={`k2b-data-panel ${props.class ?? ""}`}>{props.children}</section>
    </DataTablePanelContext.Provider>
  );
};

const DataTableHeader = (props: DataTableHeaderProps): JSX.Element => {
  const panel = useContext(DataTablePanelContext);
  panel?.registerHeading();

  return (
    <div class={`k2b-data-panel__header ${props.class ?? ""}`}>
      <PanelHeader
        title={<span id={panel?.headingId}>{props.title}</span>}
        subtitle={props.subtitle}
        actions={props.children}
        as={props.as}
        size={props.size}
      />
    </div>
  );
};

const DataTableControls = (props: DataTableControlsProps): JSX.Element => (
  <div class={`k2b-data-panel__controls ${props.class ?? ""}`}>{props.children}</div>
);

const DataTablePanelFooter = (props: DataTablePanelFooterProps): JSX.Element => (
  <footer class={`k2b-data-panel__footer ${props.class ?? ""}`}>{props.children}</footer>
);

type DataTableComponent = {
  <T>(props: DataTableProps<T>): JSX.Element;
  Panel: (props: DataTablePanelProps) => JSX.Element;
  Header: (props: DataTableHeaderProps) => JSX.Element;
  Controls: (props: DataTableControlsProps) => JSX.Element;
  Footer: (props: DataTablePanelFooterProps) => JSX.Element;
};

const DataTable = DataTableRoot as DataTableComponent;
DataTable.Panel = DataTablePanel;
DataTable.Header = DataTableHeader;
DataTable.Controls = DataTableControls;
DataTable.Footer = DataTablePanelFooter;

export default DataTable;
