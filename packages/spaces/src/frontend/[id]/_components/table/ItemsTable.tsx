import { DataTable, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import type { JSX } from "solid-js";
import type { SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import { shouldHandleDetailClick } from "../../../lib/detail";
import AssigneeAvatars from "../shared/AssigneeAvatars";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";

type Props = {
  items: SpaceItem[];
  spaceId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  selectedItemId?: string;
  baseUrl: string;
  scrollPreserveKey?: string;
  dateConfig?: DateContext;
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const PRIORITY_CLASS: Record<string, string> = {
  urgent: "text-red-500",
  high: "text-orange-500",
  medium: "text-amber-500",
  low: "text-blue-500",
};

const buildItemHref = (baseUrl: string, itemId: string) => `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}item=${itemId}`;

function CellLink(props: { href: string; class?: string; title?: string; tabIndex?: number; children: JSX.Element }) {
  return (
    <a
      href={props.href}
      tabIndex={props.tabIndex}
      class={props.class}
      title={props.title}
      onClick={(event) => {
        if (!shouldHandleDetailClick(event, event.currentTarget)) return;
        event.preventDefault();
        requestSpacesRouteNavigation(props.href, { scroll: "preserve" });
      }}
    >
      {props.children}
    </a>
  );
}

const formatSchedule = (item: SpaceItem, dateConfig?: DateContext) => {
  if (item.startsAt && item.endsAt) {
    return `${dates.formatDateTime(item.startsAt, dateConfig)} – ${dates.formatDateTime(item.endsAt, dateConfig)}`;
  }
  if (item.deadline) return dates.formatDateTime(item.deadline, dateConfig);
  return "—";
};

export default function ItemsTable(props: Props) {
  const columnsById = new Map(props.columns.map((column) => [column.id, column]));
  const tableColumns: DataTableColumn<SpaceItem>[] = [
    { id: "title", header: "Title", value: (item) => item.title, cellClass: "max-w-[24rem]" },
    { id: "status", header: "Status", value: (item) => columnsById.get(item.columnId)?.name },
    {
      id: "kind",
      header: "Kind",
      value: (item) => (Boolean(item.startsAt && item.endsAt) ? "Event" : "Task"),
      cellClass: "whitespace-nowrap",
    },
    { id: "priority", header: "Priority", value: (item) => item.priority, cellClass: "whitespace-nowrap" },
    { id: "schedule", header: "Schedule", value: (item) => formatSchedule(item, props.dateConfig), cellClass: "max-w-[18rem]" },
    {
      id: "assignees",
      header: "Assignees",
      value: (item) => item.assignees?.map((assignee) => assignee.displayName).join(", "),
      cellClass: "max-w-[14rem]",
    },
    {
      id: "tags",
      header: "Tags",
      value: (item) => item.tags?.map((tag) => tag.name).join(", "),
      cellClass: "max-w-[12rem]",
    },
    { id: "updated", header: "Updated", value: (item) => item.updatedAt, cellClass: "whitespace-nowrap" },
    { id: "created", header: "Created", value: (item) => item.createdAt, cellClass: "whitespace-nowrap" },
  ];

  return (
    <div class="paper overflow-hidden" style="view-transition-name: spaces-items-table">
      <DataTable
        rows={props.items}
        columns={tableColumns}
        getRowId={(item) => item.id}
        selectedRowId={props.selectedItemId}
        hoverRows
        class="overflow-x-auto"
        tableClass="min-w-[72rem] w-full text-xs"
        scrollPreserveKey={props.scrollPreserveKey}
        renderCell={({ row: item, col }) => {
          const column = columnsById.get(item.columnId) ?? null;
          const isEvent = Boolean(item.startsAt && item.endsAt);
          const href = buildItemHref(props.baseUrl, item.id);
          if (col.id === "title") {
            return (
              <CellLink
                href={href}
                class={`block truncate font-medium text-primary hover:underline ${item.completedAt ? "line-through text-dimmed" : ""}`}
                title={item.title}
              >
                {item.title}
              </CellLink>
            );
          }
          if (col.id === "status") {
            return (
              <CellLink href={href} class="block text-secondary" tabIndex={-1}>
                {column ? (
                  <span
                    class={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 ${
                      item.completedAt
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-[var(--ui-surface-subtle)] text-secondary"
                    }`}
                  >
                    {column.color && <span class="h-2 w-2 rounded-full" style={`background-color:${column.color}`} />}
                    <span>{column.name}</span>
                  </span>
                ) : (
                  "—"
                )}
              </CellLink>
            );
          }
          if (col.id === "kind") {
            return (
              <CellLink href={href} class="block text-secondary" tabIndex={-1}>
                {isEvent ? "Event" : "Task"}
              </CellLink>
            );
          }
          if (col.id === "priority") {
            return (
              <CellLink href={href} class="block" tabIndex={-1}>
                {item.priority ? (
                  <span
                    class={`inline-flex items-center gap-1 rounded-md bg-[var(--ui-surface-subtle)] px-2 py-0.5 ${
                      PRIORITY_CLASS[item.priority] ?? "text-dimmed"
                    }`}
                  >
                    <i class="ti ti-flag text-sm" />
                    <span>{PRIORITY_LABEL[item.priority]}</span>
                  </span>
                ) : (
                  <span class="text-dimmed">—</span>
                )}
              </CellLink>
            );
          }
          if (col.id === "schedule") {
            return (
              <CellLink href={href} class="block truncate text-secondary" title={formatSchedule(item, props.dateConfig)} tabIndex={-1}>
                {formatSchedule(item, props.dateConfig)}
              </CellLink>
            );
          }
          if (col.id === "assignees") {
            return (
              <CellLink
                href={href}
                class="flex min-w-0 items-center"
                title={item.assignees?.map((assignee) => assignee.displayName).join(", ") || "—"}
                tabIndex={-1}
              >
                <AssigneeAvatars
                  assignees={item.assignees ?? []}
                  showNames
                  empty={<span class="text-dimmed">—</span>}
                  class="w-full text-xs"
                />
              </CellLink>
            );
          }
          if (col.id === "tags") {
            return (
              <CellLink
                href={href}
                class="flex min-w-0 items-center gap-1"
                title={item.tags?.map((tag) => tag.name).join(", ") || "—"}
                tabIndex={-1}
              >
                {item.tags && item.tags.length > 0 ? (
                  <>
                    {item.tags.slice(0, 2).map((tag) => (
                      <span class="inline-flex min-w-0 items-center gap-1 rounded-md bg-[var(--ui-surface-subtle)] px-1.5 py-0.5 text-secondary">
                        <span class="h-1.5 w-1.5 shrink-0 rounded-full" style={`background-color:${tag.color}`} />
                        <span class="max-w-20 truncate">{tag.name}</span>
                      </span>
                    ))}
                    {item.tags.length > 2 && <span class="shrink-0 text-dimmed">+{item.tags.length - 2}</span>}
                  </>
                ) : (
                  <span class="text-dimmed">—</span>
                )}
              </CellLink>
            );
          }
          if (col.id === "updated") {
            return (
              <CellLink href={href} class="block text-dimmed" tabIndex={-1}>
                {dates.formatDateTime(item.updatedAt)}
              </CellLink>
            );
          }
          if (col.id === "created") {
            return (
              <CellLink href={href} class="block text-dimmed" tabIndex={-1}>
                {dates.formatDateTime(item.createdAt)}
              </CellLink>
            );
          }
          return "";
        }}
      />
    </div>
  );
}
