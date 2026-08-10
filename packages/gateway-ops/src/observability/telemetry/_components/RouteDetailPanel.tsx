import { DataTable, type DataTableColumn, DetailPanel, IconButtonLink, Placeholder } from "@k2b/ui";
import { formatDateTime, formatDurationMs } from "@valentinkolb/cloud/shared";
import type { TelemetryEventRow } from "../service";

const eventColumns: DataTableColumn<TelemetryEventRow>[] = [
  { id: "time", header: "Time" },
  { id: "method", header: "Method" },
  { id: "status", header: "Status", align: "right" },
  { id: "duration", header: "Duration", align: "right" },
];

const statusTone = (status: number) => {
  if (status >= 500) return "text-red-500";
  if (status === 429) return "text-violet-600 dark:text-violet-400";
  if (status >= 400) return "text-amber-600 dark:text-amber-400";
  return "text-dimmed";
};

export type RouteDetailPanelProps = {
  route: string;
  events: TelemetryEventRow[];
  eventLimit: number;
  slowRequestMs: number;
  closeHref: string;
};

export default function RouteDetailPanel(props: RouteDetailPanelProps) {
  return (
    <aside class="paper min-h-0 p-3" aria-label="Route detail">
      <DetailPanel>
        <DetailPanel.Header
          icon="ti ti-route"
          title={<code class="font-mono">{props.route}</code>}
          subtitle={`Last ${props.eventLimit} requests in this range`}
          actions={
            <IconButtonLink href={props.closeHref} size="sm" label="Close route detail">
              <i class="ti ti-x" aria-hidden="true" />
            </IconButtonLink>
          }
        />

        <DetailPanel.Body>
          <DetailPanel.Section title="Requests" icon="ti ti-list-details" tone="accent">
            {props.events.length === 0 ? (
              <Placeholder variant="compact" description="No individual requests retained for this range." />
            ) : (
              <DataTable
                rows={props.events}
                columns={eventColumns}
                getRowId={(row) => String(row.id)}
                highlightColumns={false}
                density="compact"
                renderCell={({ row, col }) => {
                  if (col.id === "time") return <span class="text-[10px] text-dimmed">{formatDateTime(row.occurredAt)}</span>;
                  if (col.id === "method") return <span class="text-[10px] font-medium text-dimmed">{row.method}</span>;
                  if (col.id === "status")
                    return (
                      <span class={`text-[10px] tabular-nums ${statusTone(row.status)}`} title={row.errorKind ?? undefined}>
                        {row.status}
                      </span>
                    );
                  if (col.id === "duration")
                    return (
                      <span
                        class={`text-[10px] tabular-nums ${row.durationMs >= props.slowRequestMs ? "text-amber-600 dark:text-amber-400" : "text-dimmed"}`}
                      >
                        {formatDurationMs(row.durationMs)}
                      </span>
                    );
                  return "";
                }}
              />
            )}
          </DetailPanel.Section>
        </DetailPanel.Body>
      </DetailPanel>
    </aside>
  );
}
