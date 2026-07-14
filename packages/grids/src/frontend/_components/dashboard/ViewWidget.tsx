import type { DateContext } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import type { Widget } from "../../../service";
import DatabaseTable from "../table/DatabaseTable";
import SourceAccessHint from "./SourceAccessHint";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: Extract<Widget, { kind: "view" }>;
  data: WidgetData;
  /** Slug of the parent base — prepended to the view-deep-link in the
   *  header. Only used when `data.fullViewLink` is non-null. */
  baseShortId: string;
  dateConfig?: DateContext;
};

/**
 * Embedded view widget — renders the first 25 records of either a
 * saved view OR a raw table inline on the dashboard. Read-only on
 * purpose: drilldown happens via the "Open full view →" header link
 * to the records page (only available for saved-view sources; raw-
 * table sources don't have a natural drilldown destination).
 *
 * Uses `<DatabaseTable>` for rendering — the same presentational
 * component the records page uses. Relations show up as proper
 * `<RecordLink>`s via the pre-fetched `record.expanded` map (no
 * render-time DB calls; the resolver above sets `includeRelations:
 * true` on the record.list call).
 *
 * We don't mount the full RecordsView island here: that would pull
 * in toolbar editors (filter / sort / aggregations) we don't want
 * surfaced from a dashboard cell, and every embedded view would
 * hydrate as its own island, multiplying client bundle cost. The
 * dumb table + header is the right shape for this surface.
 */
export default function ViewWidget(props: Props) {
  const isView = (d: WidgetData): d is Extract<WidgetData, { kind: "view" }> => d.kind === "view";

  const fullViewHref = () => {
    if (!isView(props.data) || !props.data.fullViewLink) return null;
    const { tableShortId, viewShortId } = props.data.fullViewLink;
    return `/app/grids/${props.baseShortId}/table/${tableShortId}/view/${viewShortId}`;
  };

  const titleOf = () => props.widget.title ?? (isView(props.data) ? props.data.title : "View");

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <header class="px-3 py-2 flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-primary truncate">{titleOf()}</span>
        <SourceAccessHint href={fullViewHref()} sourceAccess={isView(props.data) ? props.data.sourceAccess : undefined} />
      </header>

      <Show
        when={isView(props.data)}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed">
            <Show when={props.data.kind === "error"} fallback="Loading…">
              <span class="text-red-600 dark:text-red-400">{(props.data as { kind: "error"; reason: string }).reason}</span>
            </Show>
          </div>
        }
      >
        {(() => {
          // Pack the resolver's separate fields + records into the
          // RecordList shape DatabaseTable expects. The resolver
          // already requested includeRelations so each record carries
          // its own .expanded map.
          //
          // The widget owns the frame. The shared table renders flat inside
          // it so the dashboard does not create a second nested paper.
          const viewData = props.data as Extract<WidgetData, { kind: "view" }>;
          return (
            <div class="flex min-h-0 flex-1 flex-col">
              <DatabaseTable
                result={{
                  items: viewData.records,
                  fields: viewData.fields,
                  nextCursor: null,
                }}
                baseId={props.baseShortId}
                tableShortIds={viewData.tableShortIds}
                viewColumns={viewData.viewColumns}
                showColumnSubtitles={false}
                dateConfig={props.dateConfig}
                class="min-h-0 flex-1 overflow-auto"
              />
            </div>
          );
        })()}
      </Show>
    </div>
  );
}
