import { DataTable, type DataTableColumn, StatusBadge, type StatusTone } from "@k2b/ui";
import type {
  MailAutomationActivityItem,
  MailAutomationActivityKind,
  MailAutomationActivityStatus,
} from "../../service/automation-workspace";

const kindLabels: Record<MailAutomationActivityKind, string> = {
  automatic_reply: "Automatic reply",
  mail_rule: "Mail rule",
  ai_automation: "AI automation",
  workflow: "Workflow",
  backfill: "Backfill",
};

const statusTone = (status: MailAutomationActivityStatus): StatusTone => {
  if (status === "succeeded" || status === "completed") return "ok";
  if (status === "failed" || status === "needs_attention") return "error";
  if (status === "queued" || status === "running" || status === "waiting") return "running";
  return "neutral";
};

const statusLabel = (status: MailAutomationActivityStatus): string => {
  const label = status.replaceAll("_", " ");
  return `${label[0]?.toLocaleUpperCase() ?? ""}${label.slice(1)}`;
};

const formatDuration = (durationMs: number | null): string => {
  if (durationMs === null) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return `${(durationMs / 60_000).toFixed(1)}m`;
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const columns: DataTableColumn<MailAutomationActivityItem>[] = [
  { id: "kind", header: "Type", value: (row) => kindLabels[row.kind], class: "w-40" },
  { id: "name", header: "Automation", value: (row) => row.name },
  { id: "status", header: "Status", value: (row) => row.status, class: "w-36" },
  { id: "detail", header: "Details", value: (row) => row.detail },
  { id: "duration", header: "Duration", value: (row) => row.durationMs, align: "right", class: "w-28" },
  { id: "occurredAt", header: "Started", value: (row) => row.occurredAt, class: "w-48" },
];

export default function MailAutomationActivityTable(props: { items: MailAutomationActivityItem[]; empty?: string; compact?: boolean }) {
  return (
    <DataTable
      rows={props.items}
      columns={columns}
      getRowId={(row) => row.id}
      density={props.compact ? "compact" : "normal"}
      hoverRows
      highlightColumns
      empty={props.empty ?? "No automation activity in the last 30 days."}
      class="overflow-x-auto"
      renderCell={({ row, col, render }) => {
        if (col.id === "kind") return <StatusBadge tone="neutral" label={kindLabels[row.kind]} icon={null} />;
        if (col.id === "name")
          return (
            <a class="block truncate font-medium text-primary hover:underline" href={row.href}>
              {row.name}
            </a>
          );
        if (col.id === "status")
          return (
            <StatusBadge
              tone={statusTone(row.status)}
              label={statusLabel(row.status)}
              icon={["queued", "running", "waiting"].includes(row.status) ? "ti ti-loader-2 animate-spin" : undefined}
            />
          );
        if (col.id === "detail") return <span class="block whitespace-normal">{row.detail ?? "—"}</span>;
        if (col.id === "duration") return <span class="tabular-nums">{formatDuration(row.durationMs)}</span>;
        if (col.id === "occurredAt") return <time dateTime={row.occurredAt}>{formatDate(row.occurredAt)}</time>;
        return render(row.detail);
      }}
      cellContentClass="min-w-0"
    />
  );
}
