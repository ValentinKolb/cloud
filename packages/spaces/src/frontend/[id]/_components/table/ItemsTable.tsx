import { DataTable, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { dates, type DateContext } from "@valentinkolb/stdlib";
import type { JSX } from "solid-js";
import type { SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import { shouldHandleDetailClick } from "../../../lib/detail";
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

const formatSchedule = (item: SpaceItem) => {
  if (item.startsAt && item.endsAt) {
    return `${dates.formatDateTime(item.startsAt)} -> ${dates.formatDateTime(item.endsAt)}`;
  }
  if (item.deadline) return dates.formatDateTime(item.deadline);
  return "—";
};

export default function ItemsTable(props: Props) {
  const columnsById = new Map(props.columns.map((column) => [column.id, column]));
  const tableColumns: DataTableColumn<SpaceItem>[] = [
    { id: "title", header: "Title", value: (item) => item.title, cellClass: "max-w-[24rem]" },
    { id: "kanban", header: "Kanban", value: (item) => columnsById.get(item.columnId)?.name },
    {
      id: "kind",
      header: "Kind",
      value: (item) => (Boolean(item.startsAt && item.endsAt) ? "Event" : "Task"),
      cellClass: "whitespace-nowrap",
    },
    { id: "priority", header: "Priority", value: (item) => item.priority, cellClass: "whitespace-nowrap" },
    { id: "schedule", header: "Schedule", value: formatSchedule, cellClass: "max-w-[18rem]" },
    {
      id: "assignees",
      header: "Assignees",
      value: (item) => item.assignees?.map((assignee) => assignee.displayName).join(", "),
      class: "hidden xl:table-cell",
      cellClass: "max-w-[14rem]",
    },
    {
      id: "tags",
      header: "Tags",
      value: (item) => item.tags?.map((tag) => tag.name).join(", "),
      class: "hidden xl:table-cell",
      cellClass: "max-w-[12rem]",
    },
    { id: "updated", header: "Updated", value: (item) => item.updatedAt, cellClass: "whitespace-nowrap" },
    { id: "created", header: "Created", value: (item) => item.createdAt, class: "hidden 2xl:table-cell", cellClass: "whitespace-nowrap" },
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
          if (col.id === "kanban") {
            return (
              <CellLink href={href} class="block text-secondary" tabIndex={-1}>
                {column ? (
                  <span class="inline-flex items-center gap-1.5">
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
                  <span class={`inline-flex items-center gap-1 ${PRIORITY_CLASS[item.priority] ?? "text-dimmed"}`}>
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
              <CellLink href={href} class="block truncate text-secondary" title={formatSchedule(item)} tabIndex={-1}>
                {formatSchedule(item)}
              </CellLink>
            );
          }
          if (col.id === "assignees") {
            return (
              <CellLink
                href={href}
                class="block truncate text-secondary"
                title={item.assignees?.map((assignee) => assignee.displayName).join(", ") || "—"}
                tabIndex={-1}
              >
                {item.assignees && item.assignees.length > 0 ? item.assignees.map((assignee) => assignee.displayName).join(", ") : "—"}
              </CellLink>
            );
          }
          if (col.id === "tags") {
            return (
              <CellLink
                href={href}
                class="block truncate text-secondary"
                title={item.tags?.map((tag) => tag.name).join(", ") || "—"}
                tabIndex={-1}
              >
                {item.tags && item.tags.length > 0 ? item.tags.map((tag) => tag.name).join(", ") : "—"}
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
