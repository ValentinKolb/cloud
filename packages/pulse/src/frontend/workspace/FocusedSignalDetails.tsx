import { StructuredDataPreview } from "@valentinkolb/cloud/ui";
import type { PulseCurrentState, PulseMetricSeries, PulseRecordedEvent } from "../../contracts";
import { compactDateWithDelta, formatSignalValue, formatValue, signalSubject, type PulseDateContext } from "./helpers";

type SourceProps = {
  sourceId: string | null | undefined;
  sourceNameById: () => Map<string, string>;
  dateContext: PulseDateContext;
  openSource: (sourceId: string | null | undefined) => void;
};

const SourceInlineLink = (props: SourceProps) => {
  if (!props.sourceId) return <span class="text-xs text-dimmed">-</span>;
  return (
    <button
      type="button"
      class="inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-secondary transition hover:text-blue-600 dark:hover:text-blue-300"
      onClick={() => props.openSource(props.sourceId)}
      title="Open source"
    >
      <i class="ti ti-database-share shrink-0" />
      <span class="truncate">{props.sourceNameById().get(props.sourceId) ?? "Unknown source"}</span>
    </button>
  );
};

export const FocusedMetricSeriesDetail = (props: SourceProps & { item: PulseMetricSeries; metricName: string; metricUnit: string | null }) => (
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
    <section class="detail-section-compact">
      <div class="min-w-0">
        <p class="text-label text-xs">Metric variant</p>
        <h2 class="mt-1 truncate text-base font-semibold leading-5 text-primary">{signalSubject(props.item)}</h2>
        <p class="mt-1 text-xs text-dimmed">
          {props.metricName} · {props.sourceNameById().get(props.item.sourceId ?? "") ?? "No source"}
        </p>
      </div>
    </section>
    <div class="detail-stack">
      <section class="detail-section">
        <h3 class="detail-section-label">Variant</h3>
        <div class="detail-row">
          <i class="ti ti-number detail-row-icon text-blue-500" />
          <span class="detail-row-label">Current</span>
          <span class="truncate">
            {props.item.latestValue === null ? "-" : `${formatValue(props.item.latestValue)}${props.metricUnit ? ` ${props.metricUnit}` : ""}`}
          </span>
        </div>
        <div class="detail-row">
          <i class="ti ti-chart-dots detail-row-icon text-blue-500" />
          <span class="detail-row-label">Metric</span>
          <span class="truncate">{props.metricName}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-cube detail-row-icon text-emerald-600" />
          <span class="detail-row-label">Subject</span>
          <span class="truncate">{signalSubject(props.item)}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-database detail-row-icon text-violet-500" />
          <span class="detail-row-label">Source</span>
          <span>
            <SourceInlineLink {...props} sourceId={props.item.sourceId} />
          </span>
        </div>
        <div class="detail-row">
          <i class="ti ti-clock detail-row-icon text-blue-500" />
          <span class="detail-row-label">Last seen</span>
          <span>{(props.item.latestSampleAt ?? props.item.lastSeenAt) ? compactDateWithDelta((props.item.latestSampleAt ?? props.item.lastSeenAt)!, props.dateContext) : "-"}</span>
        </div>
      </section>
      <section class="detail-section">
        <StructuredDataPreview title="Dimensions" data={props.item.dimensions} empty="No dimensions." />
      </section>
    </div>
  </div>
);

export const FocusedStateDetail = (props: SourceProps & { state: PulseCurrentState }) => (
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
    <section class="detail-section-compact">
      <div class="min-w-0">
        <p class="text-label text-xs">State variant</p>
        <h2 class="mt-1 truncate text-base font-semibold leading-5 text-primary">{signalSubject(props.state)}</h2>
        <p class="mt-1 text-xs text-dimmed">
          {props.state.key} · {props.sourceNameById().get(props.state.sourceId ?? "") ?? "No source"}
        </p>
      </div>
    </section>
    <div class="detail-stack">
      <section class="detail-section">
        <h3 class="detail-section-label">Current value</h3>
        <div class="detail-row">
          <i class="ti ti-toggle-right detail-row-icon text-blue-500" />
          <span class="detail-row-label">Value</span>
          <span class="truncate">{formatSignalValue(props.state.value)}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-cube detail-row-icon text-emerald-600" />
          <span class="detail-row-label">Subject</span>
          <span class="truncate">{signalSubject(props.state)}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-database detail-row-icon text-violet-500" />
          <span class="detail-row-label">Source</span>
          <span>
            <SourceInlineLink {...props} sourceId={props.state.sourceId} />
          </span>
        </div>
        <div class="detail-row">
          <i class="ti ti-clock detail-row-icon text-blue-500" />
          <span class="detail-row-label">Updated</span>
          <span>{compactDateWithDelta(props.state.updatedAt, props.dateContext)}</span>
        </div>
      </section>
      <section class="detail-section">
        <StructuredDataPreview title="Dimensions" data={props.state.dimensions} empty="No dimensions." />
      </section>
    </div>
  </div>
);

export const FocusedEventDetail = (props: SourceProps & { event: PulseRecordedEvent }) => (
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
    <section class="detail-section-compact">
      <div class="min-w-0">
        <p class="text-label text-xs">Event row</p>
        <h2 class="mt-1 truncate text-base font-semibold leading-5 text-primary">{signalSubject(props.event)}</h2>
        <p class="mt-1 text-xs text-dimmed">
          {props.event.kind} · {props.sourceNameById().get(props.event.sourceId ?? "") ?? "No source"}
        </p>
      </div>
    </section>
    <div class="detail-stack">
      <section class="detail-section">
        <h3 class="detail-section-label">Event</h3>
        <div class="detail-row">
          <i class="ti ti-bolt detail-row-icon text-blue-500" />
          <span class="detail-row-label">Kind</span>
          <span class="truncate">{props.event.kind}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-number detail-row-icon text-blue-500" />
          <span class="detail-row-label">Value</span>
          <span>{props.event.value === null ? "-" : formatValue(props.event.value)}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-cube detail-row-icon text-emerald-600" />
          <span class="detail-row-label">Subject</span>
          <span class="truncate">{signalSubject(props.event)}</span>
        </div>
        <div class="detail-row">
          <i class="ti ti-database detail-row-icon text-violet-500" />
          <span class="detail-row-label">Source</span>
          <span>
            <SourceInlineLink {...props} sourceId={props.event.sourceId} />
          </span>
        </div>
        <div class="detail-row">
          <i class="ti ti-clock detail-row-icon text-blue-500" />
          <span class="detail-row-label">Time</span>
          <span>{compactDateWithDelta(props.event.ts, props.dateContext)}</span>
        </div>
      </section>
      <section class="detail-section">
        <StructuredDataPreview title="Dimensions" data={props.event.dimensions} empty="No dimensions." />
      </section>
      <section class="detail-section">
        <StructuredDataPreview title="Payload" data={props.event.payload} empty="No payload." />
      </section>
    </div>
  </div>
);
