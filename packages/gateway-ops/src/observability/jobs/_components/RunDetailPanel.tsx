import {
  DescriptionList,
  DetailPanel,
  IconButtonLink,
  isStructuredDataValue,
  Placeholder,
  StructuredDataPreview,
  type StructuredDataValue,
} from "@k2b/ui";
import type { TraceEvent, TraceSpan } from "@valentinkolb/cloud/services";
import { formatDate, formatDurationMs, formatNumber } from "@valentinkolb/cloud/shared";
import type { JSX } from "solid-js";

const traceData = (value: Record<string, unknown>): StructuredDataValue =>
  isStructuredDataValue(value) ? value : { error: "Trace data is not valid JSON." };

export type RunDetailPanelProps = {
  span: TraceSpan;
  events: TraceEvent[];
  status: JSX.Element;
  closeHref: string;
};

export default function RunDetailPanel(props: RunDetailPanelProps) {
  return (
    <aside class="paper min-h-0 p-3" aria-label="Run detail">
      <DetailPanel>
        <DetailPanel.Header
          icon="ti ti-activity"
          title={props.span.name}
          subtitle={props.span.spanKey ?? props.span.spanId}
          actions={
            <IconButtonLink href={props.closeHref} size="sm" label="Close run detail panel">
              <i class="ti ti-x" aria-hidden="true" />
            </IconButtonLink>
          }
        />

        <DetailPanel.Body>
          <DetailPanel.Summary title="Status">
            <DescriptionList
              layout="rows"
              size="sm"
              items={[
                {
                  term: "Source",
                  description: <span class="break-all font-mono">{props.span.source}</span>,
                },
                { term: "Type", description: props.span.category },
                { term: "Status", description: props.status },
                { term: "Started", description: formatDate(props.span.startedAt) },
                { term: "Ended", description: formatDate(props.span.endedAt) },
                { term: "Duration", description: formatDurationMs(props.span.durationMs) },
                { term: "Events", description: formatNumber(props.span.eventCount) },
                ...(props.span.statusMessage
                  ? [
                      {
                        term: "Message",
                        description: <span class="break-words">{props.span.statusMessage}</span>,
                      },
                    ]
                  : []),
              ]}
            />
          </DetailPanel.Summary>

          {props.span.summary || props.span.attributes ? (
            <DetailPanel.Group label="Run data">
              {props.span.summary ? (
                <DetailPanel.Section title="Summary" icon="ti ti-list-details" tone="accent">
                  <StructuredDataPreview data={traceData(props.span.summary)} maxRows={8} />
                </DetailPanel.Section>
              ) : null}
              {props.span.attributes ? (
                <DetailPanel.Section title="Attributes" icon="ti ti-braces" tone="neutral">
                  <StructuredDataPreview data={traceData(props.span.attributes)} maxRows={10} />
                </DetailPanel.Section>
              ) : null}
            </DetailPanel.Group>
          ) : null}

          <DetailPanel.Section title="Events" icon="ti ti-list" tone="neutral">
            {props.events.length === 0 ? (
              <Placeholder align="left" description="No events recorded for this run." />
            ) : (
              <ol class="m-0 flex list-none flex-col gap-3 p-0">
                {props.events.map((event) => (
                  <li>
                    <article class="min-w-0">
                      <div class="flex items-center justify-between gap-2">
                        <span class="truncate text-[11px] font-medium text-primary">{event.name}</span>
                        <span class="shrink-0 text-[10px] text-dimmed">{formatDate(event.occurredAt)}</span>
                      </div>
                      <p class="mt-1 text-[10px] text-dimmed">{event.severity}</p>
                      {event.body ? <p class="mt-1 break-words text-[10px] text-primary">{event.body}</p> : null}
                      {event.attributes ? <StructuredDataPreview class="mt-1" data={traceData(event.attributes)} maxRows={6} /> : null}
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </DetailPanel.Section>
        </DetailPanel.Body>
      </DetailPanel>
    </aside>
  );
}
