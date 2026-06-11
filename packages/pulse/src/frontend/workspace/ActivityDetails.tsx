import { Chart, DataTable, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { For, Show, type JSX } from "solid-js";
import type { MetricQueryPoint, PulseCurrentState, PulseMetricSeries, PulseMetricSummary, PulseRecordedEvent, PulseSource } from "../../contracts";
import type { ActivityEventGroup, ActivityStateGroup } from "./types";
import { compactDate, compactDateWithDelta, formatSignalValue, formatValue, gaugeMax, plural, pointsToHistogram, stateRowId } from "./helpers";

type SourceNameProps = {
  sourceNameById: () => Map<string, string>;
  openSource: (sourceId: string | null | undefined) => void;
};

type EventDetailProps = SourceNameProps & {
  group: ActivityEventGroup;
  eventColumns: DataTableColumn<PulseRecordedEvent>[];
  renderEventCell: (event: PulseRecordedEvent, col: DataTableColumn<PulseRecordedEvent>, render: (value: unknown) => JSX.Element) => JSX.Element;
  close: () => void;
  openFullView: (kind: string) => void;
};

type StateDetailProps = SourceNameProps & {
  group: ActivityStateGroup;
  stateColumns: DataTableColumn<PulseCurrentState>[];
  renderStateCell: (state: PulseCurrentState, col: DataTableColumn<PulseCurrentState>, render: (value: unknown) => JSX.Element) => JSX.Element;
  close: () => void;
  openFullView: (key: string) => void;
};

type MetricDetailProps = SourceNameProps & {
  metric: PulseMetricSummary;
  points: MetricQueryPoint[];
  series: PulseMetricSeries[];
  sources: PulseSource[];
  metricSeriesColumns: DataTableColumn<PulseMetricSeries>[];
  renderMetricSeriesCell: (
    item: PulseMetricSeries,
    col: DataTableColumn<PulseMetricSeries>,
    render: (value: unknown) => JSX.Element,
  ) => JSX.Element;
  close: () => void;
  openFullView: (metric: string) => void;
};

const ActivityMetricChart = (props: { metric: PulseMetricSummary; points: MetricQueryPoint[] }) => {
  const last = () => props.points.at(-1)?.value ?? null;

  if (props.metric.type === "gauge") {
    const value = last() ?? 0;
    return (
      <Chart
        kind="gauge"
        class="h-44 text-primary"
        value={value}
        min={0}
        max={gaugeMax(props.metric.unit, value)}
        label="Latest"
        unit={props.metric.unit ?? undefined}
      />
    );
  }

  if (props.metric.type === "counter") {
    return (
      <Chart
        kind="stat"
        class="h-36 text-primary"
        label="Rate"
        value={formatValue(last())}
        unit={props.metric.unit ?? undefined}
        sparkline={props.points.map((point) => point.value ?? 0)}
      />
    );
  }

  if (props.metric.type === "histogram") {
    return <Chart kind="histogram" class="h-44 text-dimmed" data={pointsToHistogram(props.points)} bins={12} yAxis={{ label: "Count" }} />;
  }

  return (
    <Chart
      kind="line"
      class="h-44 text-dimmed"
      series={[{ label: props.metric.name, data: props.points.map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })) }]}
      xAxis={{ format: (value) => compactDate(new Date(value).toISOString()) }}
      yAxis={{ format: (value) => formatValue(value) }}
      smooth
      area
    />
  );
};

export const ActivityEventDetail = (props: EventDetailProps) => (
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
    <section class="detail-section-compact">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-base font-semibold leading-5 text-primary">{props.group.kind}</h2>
          <p class="mt-1 text-xs text-dimmed">
            {props.group.subject} · {props.sourceNameById().get(props.group.sourceId ?? "") ?? "No source"} · {plural(props.group.rows.length, "row")}
          </p>
        </div>
        <button type="button" class="btn-simple btn-sm text-dimmed hover:text-primary" onClick={props.close}>
          <i class="ti ti-x" />
        </button>
      </div>
    </section>
    <div class="detail-stack">
      <section class="detail-section">
        <h3 class="detail-section-label">Latest event</h3>
        <div class="detail-row">
          <i class="ti ti-number detail-row-icon text-blue-500" />
          <span class="detail-row-label">Value</span>
          <span>{props.group.latest.value === null ? "-" : formatValue(props.group.latest.value)}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-clock detail-row-icon text-blue-500" />
          <span class="detail-row-label">Time</span>
          <span>{compactDateWithDelta(props.group.latest.ts)}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-database detail-row-icon text-violet-500" />
          <span class="detail-row-label">Source</span>
          <span>{props.sourceNameById().get(props.group.sourceId ?? "") ?? "-"}</span>
        </div>
        <Show when={props.group.sourceId}>
          {(sourceId) => (
            <button type="button" class="btn-input btn-input-sm mt-3 self-start" onClick={() => props.openSource(sourceId())}>
              <i class="ti ti-arrow-right" /> Open source
            </button>
          )}
        </Show>
      </section>
      <section class="detail-section overflow-hidden !p-0">
        <DataTable
          rows={props.group.rows}
          columns={props.eventColumns}
          getRowId={(event) => event.id}
          density="compact"
          class="max-h-96 overflow-auto"
          empty="No events in this group."
          renderCell={({ row, col, render }) => props.renderEventCell(row, col, render)}
        />
        <div class="px-3 py-2">
          <button type="button" class="btn-input btn-input-sm" onClick={() => props.openFullView(props.group.kind)}>
            <i class="ti ti-eye" /> Open full view
          </button>
        </div>
      </section>
    </div>
  </div>
);

export const ActivityStateDetail = (props: StateDetailProps) => (
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
    <section class="detail-section-compact">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-base font-semibold leading-5 text-primary">{props.group.key}</h2>
          <p class="mt-1 text-xs text-dimmed">
            {props.sourceNameById().get(props.group.sourceId ?? "") ?? "No source"} · {plural(props.group.rows.length, "variant")}
          </p>
        </div>
        <button type="button" class="btn-simple btn-sm text-dimmed hover:text-primary" onClick={props.close}>
          <i class="ti ti-x" />
        </button>
      </div>
    </section>
    <div class="detail-stack">
      <section class="detail-section">
        <h3 class="detail-section-label">Latest state</h3>
        <div class="detail-row">
          <i class="ti ti-toggle-right detail-row-icon text-blue-500" />
          <span class="detail-row-label">Value</span>
          <span>{formatSignalValue(props.group.latest.value)}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-clock detail-row-icon text-blue-500" />
          <span class="detail-row-label">Updated</span>
          <span>{compactDateWithDelta(props.group.latest.updatedAt)}</span>
        </div>
      </section>
      <section class="detail-section">
        <h3 class="detail-section-label">Scope</h3>
        <div class="detail-row">
          <i class="ti ti-list-details detail-row-icon text-emerald-600" />
          <span class="detail-row-label">Variants</span>
          <span>{props.group.rows.length}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-database detail-row-icon text-violet-500" />
          <span class="detail-row-label">Source</span>
          <span>{props.sourceNameById().get(props.group.sourceId ?? "") ?? "-"}</span>
        </div>
        <Show when={props.group.sourceId}>
          {(sourceId) => (
            <button type="button" class="btn-input btn-input-sm mt-3 self-start" onClick={() => props.openSource(sourceId())}>
              <i class="ti ti-arrow-right" /> Open source
            </button>
          )}
        </Show>
      </section>
      <section class="detail-section overflow-hidden !p-0">
        <DataTable
          rows={props.group.rows}
          columns={props.stateColumns}
          getRowId={stateRowId}
          density="compact"
          class="max-h-96 overflow-auto"
          empty="No variants in this group."
          renderCell={({ row, col, render }) => props.renderStateCell(row, col, render)}
        />
        <div class="px-3 py-2">
          <button type="button" class="btn-input btn-input-sm" onClick={() => props.openFullView(props.group.key)}>
            <i class="ti ti-eye" /> Open full view
          </button>
        </div>
      </section>
    </div>
  </div>
);

export const ActivityMetricDetail = (props: MetricDetailProps) => (
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
    <section class="detail-section-compact">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-base font-semibold leading-5 text-primary">{props.metric.name}</h2>
          <p class="mt-1 text-xs text-dimmed">
            {props.metric.type} · {props.metric.seriesCount} variants{props.metric.unit ? ` · ${props.metric.unit}` : ""}
          </p>
        </div>
        <button type="button" class="btn-simple btn-sm text-dimmed hover:text-primary" onClick={props.close}>
          <i class="ti ti-x" />
        </button>
      </div>
    </section>
    <div class="detail-stack">
      <section class="detail-section">
        <Show when={props.metric.seriesCount > 1}>
          <p class="mb-2 text-xs leading-relaxed text-dimmed">
            Preview aggregates {props.metric.seriesCount} variants. A variant is one source/entity/dimensions combination, not one data point.
          </p>
        </Show>
        <ActivityMetricChart metric={props.metric} points={props.points} />
      </section>
      <section class="detail-section">
        <h3 class="detail-section-label">Metric</h3>
        <div class="detail-row">
          <i class="ti ti-clock detail-row-icon text-blue-500" />
          <span class="detail-row-label">Last seen</span>
          <span>{props.metric.lastSeenAt ? compactDateWithDelta(props.metric.lastSeenAt) : "-"}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-stack-3 detail-row-icon text-emerald-600" />
          <span class="detail-row-label">Variants</span>
          <span>{props.metric.seriesCount}</span>
        </div>
      </section>
      <section class="detail-section overflow-hidden !p-0">
        <DataTable
          rows={props.series.slice(0, 25)}
          columns={props.metricSeriesColumns}
          getRowId={(item) => item.id}
          density="compact"
          class="max-h-96 overflow-auto"
          empty="No variants loaded for this metric."
          renderCell={({ row, col, render }) => props.renderMetricSeriesCell(row, col, render)}
        />
        <div class="px-3 py-2">
          <button type="button" class="btn-input btn-input-sm" onClick={() => props.openFullView(props.metric.name)}>
            <i class="ti ti-eye" /> Open full view
          </button>
        </div>
      </section>
      <section class="detail-section">
        <h3 class="detail-section-label">Sources</h3>
        <Show when={props.sources.length} fallback={<p class="text-xs text-dimmed">No source attached to this metric yet.</p>}>
          <div class="flex flex-col gap-2">
            <For each={props.sources}>
              {(source) => (
                <button type="button" class="btn-input btn-input-sm justify-start" onClick={() => props.openSource(source.id)}>
                  <i class="ti ti-database-share" /> {source.name}
                </button>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  </div>
);
