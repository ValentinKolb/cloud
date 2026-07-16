import { Show } from "solid-js";
import type { Widget } from "../../../service";
import QueryResultTable from "../query/QueryResultTable";
import SourceAccessHint from "./SourceAccessHint";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: Extract<Widget, { kind: "view" }>;
  data: WidgetData;
  /** Slug of the parent base — prepended to the view-deep-link in the
   *  header. Only used when `data.fullViewLink` is non-null. */
  baseShortId: string;
};

/**
 * Embedded view widget. The server executes the saved GQL exactly and
 * supplies its first page, including grouped and aggregate-only results.
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
        when={isView(props.data) ? props.data : null}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed">
            <Show when={props.data.kind === "error"} fallback="Loading…">
              <span class="text-red-600 dark:text-red-400">{(props.data as { kind: "error"; reason: string }).reason}</span>
            </Show>
          </div>
        }
      >
        {(viewData) => (
          <QueryResultTable
            result={viewData().queryResult}
            baseShortId={props.baseShortId}
            tableShortIds={viewData().tableShortIds}
            fieldsByTable={viewData().fieldsByTable}
            scrollPreserveKey={`grids-dashboard-view-${props.widget.id}`}
            surface="flat"
          />
        )}
      </Show>
    </div>
  );
}
