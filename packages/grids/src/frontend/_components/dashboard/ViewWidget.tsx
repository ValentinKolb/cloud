import { Show, For } from "solid-js";
import type { Widget } from "../../../service";
import { formatCell } from "../format-cell";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: Extract<Widget, { kind: "view" }>;
  data: WidgetData;
  /** Slug of the parent base — used to build the "Open full view" link. */
  baseSlug: string;
};

/**
 * Embedded view widget — renders the first 25 records of a saved view
 * inline on the dashboard. Read-only on purpose: drilldown happens via
 * the "Open full view →" header link to the records page, where the
 * user gets the full toolbar / pagination / record-detail panel.
 *
 * We deliberately don't mount the full RecordsView island here. Three
 * reasons: (a) RecordsView depends on URL-driven query state which
 * doesn't exist on a dashboard, (b) it pulls in toolbar editors
 * (filter / sort / aggregations) we don't want surfaced from a
 * dashboard cell, (c) every embedded view would hydrate as its own
 * island, multiplying client bundle cost on big dashboards. A simple
 * read-only table is the right shape for this surface.
 */
export default function ViewWidget(props: Props) {
  const titleOf = () =>
    props.widget.title ?? (props.data.kind === "view" ? props.data.view.name : "View");

  const fullViewHref = () => {
    if (props.data.kind !== "view") return null;
    const v = props.data.view;
    return `/app/grids/${props.baseSlug}?table=${v.tableId}&view=${v.slug}`;
  };

  return (
    <div class="paper h-full flex flex-col min-h-0 min-w-0 overflow-hidden">
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

      {/* Body */}
      <Show
        when={props.data.kind === "view"}
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
  // Honour the view's column ordering when present; otherwise fall
  // back to the default-visibility set sorted by position. Same logic
  // RecordsGrid uses, simplified for read-only.
  const visibleFields = () => {
    const cols = props.data.view.query.columns;
    if (cols && cols.length > 0) {
      const byId = new Map(props.data.fields.map((f) => [f.id, f]));
      return cols
        .map((c) => byId.get(c.fieldId))
        .filter((f): f is NonNullable<typeof f> => !!f && !f.deletedAt);
    }
    return props.data.fields
      .filter((f) => !f.deletedAt && !f.hideInTable)
      .sort((a, b) => a.position - b.position);
  };

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
