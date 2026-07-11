import { DataTable, Panes, TextInput, type DataTableColumn, type PanesValue } from "@valentinkolb/cloud/ui";
import { createMemo, Show, type Accessor, type JSX, type Setter } from "solid-js";
import type { PulseCurrentState, PulseMetricSeries, PulseMetricSummary, PulseRecordedEvent } from "../../contracts";
import { FocusedEventDetail, FocusedMetricSeriesDetail, FocusedStateDetail } from "./FocusedSignalDetails";
import { plural, stateRowId, type PulseDateContext } from "./helpers";
import type { WorkspaceView } from "./types";

type CellRenderer<Row> = (row: Row, col: DataTableColumn<Row>, render: (value: unknown) => JSX.Element) => JSX.Element;
type FocusedSignalKind = "metric" | "state" | "event";

type FocusedSignalViewProps = {
  view: Accessor<WorkspaceView>;
  signalId: Accessor<string>;
  focusedMetric: Accessor<PulseMetricSummary | null>;
  metricSeries: Accessor<PulseMetricSeries[]>;
  states: Accessor<PulseCurrentState[]>;
  events: Accessor<PulseRecordedEvent[]>;
  hasMore: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  panesValue: Accessor<PanesValue>;
  setPanesValue: Setter<PanesValue>;
  search: Accessor<string>;
  setSearch: Setter<string>;
  selectedSeries: Accessor<PulseMetricSeries | null>;
  selectedState: Accessor<PulseCurrentState | null>;
  selectedEvent: Accessor<PulseRecordedEvent | null>;
  setSelectedSeriesId: Setter<string>;
  setSelectedStateId: Setter<string>;
  setSelectedEventId: Setter<string>;
  metricSeriesColumns: DataTableColumn<PulseMetricSeries>[];
  stateColumns: DataTableColumn<PulseCurrentState>[];
  eventColumns: DataTableColumn<PulseRecordedEvent>[];
  renderMetricSeriesCell: CellRenderer<PulseMetricSeries>;
  renderStateCell: CellRenderer<PulseCurrentState>;
  renderEventCell: CellRenderer<PulseRecordedEvent>;
  loadRows: (options?: { append?: boolean }) => void | Promise<void>;
  onOpenQuery: () => void;
  sourceNameById: () => Map<string, string>;
  dateContext: Accessor<PulseDateContext>;
  openSource: (sourceId: string | null | undefined) => void;
};

const focusedSignalKind = (view: WorkspaceView): FocusedSignalKind => {
  if (view === "metric-detail") return "metric";
  if (view === "state-detail") return "state";
  return "event";
};

const focusedSignalTitle = (kind: FocusedSignalKind) => (kind === "metric" ? "Metric" : kind === "state" ? "State" : "Event");
const focusedSignalIcon = (kind: FocusedSignalKind) => (kind === "metric" ? "ti-stack-3" : kind === "state" ? "ti-toggle-right" : "ti-bolt");
const focusedSignalRowsTitle = (kind: FocusedSignalKind) => (kind === "event" ? "Events" : "Variants");
const focusedSearchPlaceholder = (kind: FocusedSignalKind) =>
  kind === "metric" ? "Search variants..." : kind === "state" ? "Search state variants..." : "Search events...";
const focusedRowsLabel = (kind: FocusedSignalKind, props: FocusedSignalViewProps) =>
  kind === "metric" ? plural(props.metricSeries().length, "variant") : kind === "state" ? plural(props.states().length, "variant") : plural(props.events().length, "event");
const focusedSubtitle = (kind: FocusedSignalKind, props: FocusedSignalViewProps, rowsLabel: string) => {
  if (kind === "metric") return `${props.focusedMetric()?.type ?? "metric"}${props.focusedMetric()?.unit ? ` · ${props.focusedMetric()?.unit}` : ""} · ${rowsLabel}`;
  return `${kind} · ${rowsLabel}`;
};

const FocusedSignalHeader = (props: FocusedSignalViewProps & { kind: Accessor<FocusedSignalKind>; rowsLabel: Accessor<string> }) => (
  <div class="paper shrink-0 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-label text-xs">{focusedSignalTitle(props.kind())}</p>
        <h2 class="mt-1 truncate text-xl font-semibold text-primary">{props.signalId()}</h2>
        <p class="mt-1 text-sm text-dimmed">{focusedSubtitle(props.kind(), props, props.rowsLabel())}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-input btn-input-sm" onClick={() => void props.loadRows()}>
          <i class={`ti ${props.loadingMore() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} /> Reload
        </button>
        <button type="button" class="btn-input btn-input-sm" onClick={props.onOpenQuery}>
          <i class="ti ti-code" /> Open query
        </button>
      </div>
    </div>
  </div>
);

const FocusedSignalSearch = (props: FocusedSignalViewProps & { kind: Accessor<FocusedSignalKind>; rowsLabel: Accessor<string> }) => (
  <div class="flex shrink-0 flex-wrap items-center gap-2">
    <div class="min-w-64 flex-1">
      <TextInput
        type="search"
        icon="ti ti-search"
        value={props.search}
        onInput={(value) => props.setSearch(value)}
        placeholder={focusedSearchPlaceholder(props.kind())}
        clearable
      />
    </div>
    <span class="chip">
      <i class={focusedSignalIcon(props.kind())} />
      {props.rowsLabel()}
    </span>
  </div>
);

const FocusedMetricTable = (props: FocusedSignalViewProps) => (
  <DataTable
    rows={props.metricSeries()}
    columns={props.metricSeriesColumns}
    getRowId={(item) => item.id}
    selectedRowId={props.selectedSeries()?.id ?? null}
    onRowClick={(item) => props.setSelectedSeriesId(item.id)}
    density="compact"
    fillHeight
    class="min-h-0 flex-1 overflow-auto"
    empty="No variants found."
    hasMore={props.hasMore()}
    loadingMore={props.loadingMore()}
    onLoadMore={() => void props.loadRows({ append: true })}
    scrollPreserveKey={`pulse-focused-metric-${props.signalId()}`}
    renderCell={({ row, col, render }) => props.renderMetricSeriesCell(row, col, render)}
  />
);

const FocusedStateTable = (props: FocusedSignalViewProps & { selectedStateRowId: Accessor<string | null> }) => (
  <DataTable
    rows={props.states()}
    columns={props.stateColumns}
    getRowId={stateRowId}
    selectedRowId={props.selectedStateRowId()}
    onRowClick={(state) => props.setSelectedStateId(stateRowId(state))}
    density="compact"
    fillHeight
    class="min-h-0 flex-1 overflow-auto"
    empty="No state variants found."
    hasMore={props.hasMore()}
    loadingMore={props.loadingMore()}
    onLoadMore={() => void props.loadRows({ append: true })}
    scrollPreserveKey={`pulse-focused-state-${props.signalId()}`}
    renderCell={({ row, col, render }) => props.renderStateCell(row, col, render)}
  />
);

const FocusedEventTable = (props: FocusedSignalViewProps) => (
  <DataTable
    rows={props.events()}
    columns={props.eventColumns}
    getRowId={(event) => event.id}
    selectedRowId={props.selectedEvent()?.id ?? null}
    onRowClick={(event) => props.setSelectedEventId(event.id)}
    density="compact"
    fillHeight
    class="min-h-0 flex-1 overflow-auto"
    empty="No events found."
    hasMore={props.hasMore()}
    loadingMore={props.loadingMore()}
    onLoadMore={() => void props.loadRows({ append: true })}
    scrollPreserveKey={`pulse-focused-event-${props.signalId()}`}
    renderCell={({ row, col, render }) => props.renderEventCell(row, col, render)}
  />
);

const FocusedSignalTable = (props: FocusedSignalViewProps & { kind: Accessor<FocusedSignalKind>; selectedStateRowId: Accessor<string | null> }) => (
  <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
    <Show when={props.kind() === "metric"}>
      <FocusedMetricTable {...props} />
    </Show>
    <Show when={props.kind() === "state"}>
      <FocusedStateTable {...props} selectedStateRowId={props.selectedStateRowId} />
    </Show>
    <Show when={props.kind() === "event"}>
      <FocusedEventTable {...props} />
    </Show>
  </div>
);

const FocusedMetricDetailPane = (props: FocusedSignalViewProps) => (
  <Show when={props.selectedSeries()} keyed fallback={<div class="paper h-full p-4 text-sm text-dimmed">Select a metric variant.</div>}>
    {(item) => (
      <FocusedMetricSeriesDetail
        item={item}
        metricName={props.signalId()}
        sourceId={item.sourceId}
        sourceNameById={props.sourceNameById}
        dateContext={props.dateContext()}
        metricUnit={props.focusedMetric()?.unit ?? null}
        openSource={props.openSource}
      />
    )}
  </Show>
);

const FocusedStateDetailPane = (props: FocusedSignalViewProps) => (
  <Show when={props.selectedState()} keyed fallback={<div class="paper h-full p-4 text-sm text-dimmed">Select a state variant.</div>}>
    {(state) => (
      <FocusedStateDetail
        state={state}
        sourceId={state.sourceId}
        sourceNameById={props.sourceNameById}
        dateContext={props.dateContext()}
        openSource={props.openSource}
      />
    )}
  </Show>
);

const FocusedEventDetailPane = (props: FocusedSignalViewProps) => (
  <Show when={props.selectedEvent()} keyed fallback={<div class="paper h-full p-4 text-sm text-dimmed">Select an event.</div>}>
    {(event) => (
      <FocusedEventDetail
        event={event}
        sourceId={event.sourceId}
        sourceNameById={props.sourceNameById}
        dateContext={props.dateContext()}
        openSource={props.openSource}
      />
    )}
  </Show>
);

const FocusedSignalDetailPane = (props: FocusedSignalViewProps & { kind: Accessor<FocusedSignalKind> }) => (
  <div class="h-full min-h-0 overflow-auto">
    <Show when={props.kind() === "metric"}>
      <FocusedMetricDetailPane {...props} />
    </Show>
    <Show when={props.kind() === "state"}>
      <FocusedStateDetailPane {...props} />
    </Show>
    <Show when={props.kind() === "event"}>
      <FocusedEventDetailPane {...props} />
    </Show>
  </div>
);

const FocusedSignalPanes = (props: FocusedSignalViewProps & { kind: Accessor<FocusedSignalKind>; selectedStateRowId: Accessor<string | null> }) => (
  <section class="h-[min(68vh,54rem)] min-h-[32rem] shrink-0 overflow-hidden">
    <Panes.Root
      value={props.panesValue()}
      onChange={props.setPanesValue}
      class="h-full min-h-0"
      allowMove={false}
      allowReorder={false}
      allowHorizontalSplit={false}
      allowVerticalSplit={false}
    >
      <Panes.Element id="list" title={focusedSignalRowsTitle(props.kind())} icon={focusedSignalIcon(props.kind())}>
        <FocusedSignalTable {...props} kind={props.kind} selectedStateRowId={props.selectedStateRowId} />
      </Panes.Element>

      <Panes.Element id="detail" title="Detail" icon="ti-info-circle">
        <FocusedSignalDetailPane {...props} kind={props.kind} />
      </Panes.Element>
    </Panes.Root>
  </section>
);

export default function FocusedSignalView(props: FocusedSignalViewProps) {
  const kind = createMemo(() => focusedSignalKind(props.view()));
  const rowsLabel = createMemo(() => focusedRowsLabel(kind(), props));
  const selectedStateRowId = createMemo(() => {
    const state = props.selectedState();
    return state ? stateRowId(state) : null;
  });

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-3 pb-2">
      <FocusedSignalHeader {...props} kind={kind} rowsLabel={rowsLabel} />
      <FocusedSignalSearch {...props} kind={kind} rowsLabel={rowsLabel} />
      <FocusedSignalPanes {...props} kind={kind} selectedStateRowId={selectedStateRowId} />
    </section>
  );
}
