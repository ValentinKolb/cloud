import { Show, For } from "solid-js";
import type { Widget } from "../../../service";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: Extract<Widget, { kind: "chart" }>;
  data: WidgetData;
};

/**
 * Placeholder for chart widgets. The chart-render layer is deferred to
 * P1 (the user is building a separate chart lib in parallel). The stub
 * surfaces the bucket data as a small read-only table so a chart
 * widget on a dashboard isn't a blank rectangle, and the user can
 * eyeball whether the source produces sensible numbers before the
 * proper renderer lands.
 */
export default function ChartWidgetStub(props: Props) {
  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <header class="px-3 py-2 flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-primary truncate">
          {props.widget.title ?? `${props.widget.chartType} chart`}
        </span>
        <span class="text-[10px] uppercase tracking-wider text-dimmed shrink-0">
          {props.widget.chartType}
        </span>
      </header>

      <Show
        when={props.data.kind === "chart"}
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
        <div class="flex-1 min-h-0 overflow-auto px-3 pb-3">
          <p class="text-[10px] text-dimmed mb-2">
            Chart renderer ships in P1. Bucket preview:
          </p>
          <BucketsTable data={props.data as Extract<WidgetData, { kind: "chart" }>} />
        </div>
      </Show>
    </div>
  );
}

function BucketsTable(props: { data: Extract<WidgetData, { kind: "chart" }> }) {
  const aggKeys = () => {
    const keys = new Set<string>();
    for (const b of props.data.buckets) {
      for (const k of Object.keys(b.values)) keys.add(k);
    }
    return [...keys];
  };

  return (
    <Show
      when={props.data.buckets.length > 0}
      fallback={<p class="text-xs text-dimmed">No data</p>}
    >
      <table class="w-full text-[11px]">
        <thead>
          <tr>
            <th class="text-left px-1 py-0.5 font-medium text-dimmed">Group</th>
            <For each={aggKeys()}>
              {(k) => (
                <th class="text-right px-1 py-0.5 font-medium text-dimmed truncate">
                  {k}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.data.buckets}>
            {(bucket) => (
              <tr>
                <td class="px-1 py-0.5 truncate max-w-[120px]">
                  {bucket.keys.map((k) => String(k ?? "—")).join(" · ")}
                </td>
                <For each={aggKeys()}>
                  {(k) => (
                    <td class="text-right px-1 py-0.5 tabular-nums">
                      {bucket.values[k] !== null && bucket.values[k] !== undefined
                        ? String(bucket.values[k])
                        : "—"}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}
