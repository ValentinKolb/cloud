import {
  Button,
  DescriptionList,
  DetailPanel,
  IconButton,
  isStructuredDataValue,
  StructuredDataPreview,
  type StructuredDataValue,
  Tooltip,
} from "@k2b/ui";
import { Show } from "solid-js";
import type { PulseCurrentState, PulseMetricSeries, PulseRecordedEvent } from "../../contracts";
import { compactDateWithDelta, formatMetricValue, formatSignalValue, formatValue, type PulseDateContext, signalSubject } from "./helpers";

const structuredData = (value: unknown, label: string): StructuredDataValue =>
  isStructuredDataValue(value) ? value : { error: `${label} is not valid JSON.` };

type SourceProps = {
  sourceId: string | null | undefined;
  sourceNameById: () => Map<string, string>;
  dateContext: PulseDateContext;
  openSource: (sourceId: string | null | undefined) => void;
  openQuery: () => void;
  close: () => void;
};

const SourceAction = (props: SourceProps) => (
  <Show when={props.sourceId} fallback={<p class="text-xs text-dimmed">-</p>}>
    {(sourceId) => (
      <DetailPanel.Action
        type="button"
        title={props.sourceNameById().get(sourceId()) ?? "Unknown source"}
        description="Open source"
        leading={<i class="ti ti-database-share" aria-hidden="true" />}
        trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
        onClick={() => props.openSource(sourceId())}
      />
    )}
  </Show>
);

const DetailClose = (props: SourceProps) => (
  <Tooltip.Anchor content="Close details">
    <IconButton label="Close signal details" variant="ghost" size="sm" onClick={props.close}>
      <i class="ti ti-x" />
    </IconButton>
  </Tooltip.Anchor>
);

const DetailQuickActions = (props: SourceProps) => (
  <>
    <Button type="button" variant="secondary" size="sm" onClick={props.openQuery}>
      <i class="ti ti-code" /> Open query
    </Button>
    {props.sourceId ? (
      <Button type="button" variant="secondary" size="sm" onClick={() => props.openSource(props.sourceId)}>
        <i class="ti ti-database-share" /> Source
      </Button>
    ) : null}
  </>
);

export const FocusedMetricSeriesDetail = (
  props: SourceProps & { item: PulseMetricSeries; metricName: string; metricUnit: string | null },
) => (
  <DetailPanel>
    <DetailPanel.Header
      title={signalSubject(props.item)}
      icon="ti ti-chart-dots"
      meta="Metric variant"
      subtitle={
        <>
          {props.metricName} · {props.sourceNameById().get(props.item.sourceId ?? "") ?? "No source"}
        </>
      }
      actions={<DetailClose {...props} />}
      primaryActions={
        <div class="flex flex-wrap items-center gap-2" role="group" aria-label={`${signalSubject(props.item)} actions`}>
          <DetailQuickActions {...props} />
        </div>
      }
    />
    <DetailPanel.Body>
      <DetailPanel.Summary title="Variant">
        <DescriptionList
          items={[
            {
              term: "Current",
              description: props.item.latestValue === null ? "-" : formatMetricValue(props.item.latestValue, props.metricUnit),
            },
            { term: "Metric", description: props.metricName },
            { term: "Subject", description: signalSubject(props.item) },
            {
              term: "Last seen",
              description:
                (props.item.latestSampleAt ?? props.item.lastSeenAt)
                  ? compactDateWithDelta((props.item.latestSampleAt ?? props.item.lastSeenAt)!, props.dateContext)
                  : "-",
            },
          ]}
          layout="rows"
          size="sm"
        />
      </DetailPanel.Summary>
      <DetailPanel.Group label="Signal context">
        <DetailPanel.Section title="Source" icon="ti ti-database-share" tone="accent">
          <SourceAction {...props} sourceId={props.item.sourceId} />
        </DetailPanel.Section>
        <DetailPanel.Section title="Dimensions" icon="ti ti-tags" tone="neutral">
          <StructuredDataPreview data={props.item.dimensions} empty="No dimensions." />
        </DetailPanel.Section>
      </DetailPanel.Group>
    </DetailPanel.Body>
  </DetailPanel>
);

export const FocusedStateDetail = (props: SourceProps & { state: PulseCurrentState }) => (
  <DetailPanel>
    <DetailPanel.Header
      title={signalSubject(props.state)}
      icon="ti ti-toggle-right"
      meta="State variant"
      subtitle={
        <>
          {props.state.key} · {props.sourceNameById().get(props.state.sourceId ?? "") ?? "No source"}
        </>
      }
      actions={<DetailClose {...props} />}
      primaryActions={
        <div class="flex flex-wrap items-center gap-2" role="group" aria-label={`${signalSubject(props.state)} actions`}>
          <DetailQuickActions {...props} />
        </div>
      }
    />
    <DetailPanel.Body>
      <DetailPanel.Summary title="Current value">
        <DescriptionList
          items={[
            { term: "Value", description: formatSignalValue(props.state.value) },
            { term: "Subject", description: signalSubject(props.state) },
            { term: "Updated", description: compactDateWithDelta(props.state.updatedAt, props.dateContext) },
          ]}
          layout="rows"
          size="sm"
        />
      </DetailPanel.Summary>
      <DetailPanel.Group label="Signal context">
        <DetailPanel.Section title="Source" icon="ti ti-database-share" tone="accent">
          <SourceAction {...props} sourceId={props.state.sourceId} />
        </DetailPanel.Section>
        <DetailPanel.Section title="Dimensions" icon="ti ti-tags" tone="neutral">
          <StructuredDataPreview data={props.state.dimensions} empty="No dimensions." />
        </DetailPanel.Section>
      </DetailPanel.Group>
    </DetailPanel.Body>
  </DetailPanel>
);

export const FocusedEventDetail = (props: SourceProps & { event: PulseRecordedEvent }) => (
  <DetailPanel>
    <DetailPanel.Header
      title={signalSubject(props.event)}
      icon="ti ti-bolt"
      meta="Event row"
      subtitle={
        <>
          {props.event.kind} · {props.sourceNameById().get(props.event.sourceId ?? "") ?? "No source"}
        </>
      }
      actions={<DetailClose {...props} />}
      primaryActions={
        <div class="flex flex-wrap items-center gap-2" role="group" aria-label={`${signalSubject(props.event)} actions`}>
          <DetailQuickActions {...props} />
        </div>
      }
    />
    <DetailPanel.Body>
      <DetailPanel.Summary title="Event">
        <DescriptionList
          items={[
            { term: "Kind", description: props.event.kind },
            { term: "Value", description: props.event.value === null ? "-" : formatValue(props.event.value) },
            { term: "Subject", description: signalSubject(props.event) },
            { term: "Time", description: compactDateWithDelta(props.event.ts, props.dateContext) },
          ]}
          layout="rows"
          size="sm"
        />
      </DetailPanel.Summary>
      <DetailPanel.Group label="Signal context">
        <DetailPanel.Section title="Source" icon="ti ti-database-share" tone="accent">
          <SourceAction {...props} sourceId={props.event.sourceId} />
        </DetailPanel.Section>
        <DetailPanel.Section title="Dimensions" icon="ti ti-tags" tone="neutral">
          <StructuredDataPreview data={props.event.dimensions} empty="No dimensions." />
        </DetailPanel.Section>
        <DetailPanel.Section title="Payload" icon="ti ti-braces" tone="neutral">
          <StructuredDataPreview data={structuredData(props.event.payload, "Event payload")} empty="No payload." />
        </DetailPanel.Section>
      </DetailPanel.Group>
    </DetailPanel.Body>
  </DetailPanel>
);
