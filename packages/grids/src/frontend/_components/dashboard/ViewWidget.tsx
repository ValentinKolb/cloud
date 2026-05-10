import { Show, For } from "solid-js";
import type { Widget } from "../../../service";
import { formatCell } from "../format-cell";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: Extract<Widget, { kind: "view" }>;
  data: WidgetData;
  /** Slug of the parent base — prepended to the view-deep-link in
   *  the header. Only used when `data.fullViewLink` is non-null. */
  baseShortId: string;
};

/**
 * Embedded view widget — renders the first 25 records of either a
 * saved view OR a raw table inline on the dashboard. Read-only on
 * purpose: drilldown happens via the "Open full view →" header link
 * to the records page (only available for saved-view sources; raw-
 * table sources don't have a natural drilldown destination).
 *
 * We deliberately don't mount the full RecordsView island here. Three
 * reasons: (a) RecordsView depends on URL-driven query state which
 * doesn't exist on a dashboard, (b) it pulls in toolbar editors
 * (filter / sort / aggregations) we don't want surfaced from a
 * dashboard cell, (c) every embedded view would hydrate as its own
 * island, multiplying client bundle cost on big dashboards. A simple
 * read-only table is the right shape for this surface.
 *
 * The `data` resolver upstream abstracts over both source kinds — by
 * the time it lands here, we just have a title, fields, records,
 * and an optional drilldown link. No source-kind branching needed
 * in the renderer.
 */
export default function ViewWidget(props: Props) {
  const isView = (
    d: WidgetData,
  ): d is Extract<WidgetData, { kind: "view" }> => d.kind === "view";

  const fullViewHref = () => {
    if (!isView(props.data) || !props.data.fullViewLink) return null;
    const { tableShortId, viewShortId } = props.data.fullViewLink;
    return `/app/grids/${props.baseShortId}?table=${tableShortId}&view=${viewShortId}`;
  };

  const titleOf = () =>
    props.widget.title ?? (isView(props.data) ? props.data.title : "View");

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <header class="px-3 py-2 flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-primary truncate">{titleOf()}</span>
        <Show when={fullViewHref()}>
          <a
            href={fullViewHref()!}
            class="text-[11px] text-dimmed hover:text-primary inline-flex items-center gap-1 shrink-0"
          >
            <span>Open full view</span>
            <i class="ti ti-arrow-up-right text-[10px]" />
          </a>
        </Show>
      </header>

      <Show
        when={isView(props.data)}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed">
            <Show
              when={props.data.kind === "error"}
              fallback="Loading…"
            >
              <span class="text-red-600 dark:text-red-400">
                {(props.data as { kind: "error"; reason: string }).reason}
              </span>
            </Show>
          </div>
        }
      >
        <ViewTable data={props.data as Extract<WidgetData, { kind: "view" }>} />
      </Show>
    </div>
  );
}

function ViewTable(props: { data: Extract<WidgetData, { kind: "view" }> }) {
  // Default-visibility column set sorted by position. Saved-view
  // column ordering used to be honoured here too; that lives in the
  // view's `query.columns` and isn't present in the WidgetData shape
  // anymore (the resolver picks records but not the column spec).
  // For raw-table sources there's no column spec to honour anyway.
  // P2 idea: thread `view.query.columns` through if it ever differs
  // from default-visibility.
  const visibleFields = () =>
    props.data.fields
      .filter((f) => !f.deletedAt && !f.hideInTable)
      .sort((a, b) => a.position - b.position);

  return (
    <div class="flex-1 min-h-0 overflow-auto">
      <Show
        when={props.data.records.length > 0}
        fallback={
          <div class="px-3 py-6 text-center text-xs text-dimmed">No records</div>
        }
      >
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-zinc-50 dark:bg-zinc-900/60 z-10">
            <tr>
              <For each={visibleFields()}>
                {(f) => (
                  <th class="text-left px-2 py-1 font-medium text-dimmed border-b border-zinc-200 dark:border-zinc-800 truncate">
                    {f.name}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.data.records}>
              {(rec) => (
                <tr class="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
                  <For each={visibleFields()}>
                    {(f) => (
                      <td class="px-2 py-1 align-top truncate max-w-[220px]">
                        {formatCell(rec.data[f.id], f.type, f.config)}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
