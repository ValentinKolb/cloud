import type { JSX } from "solid-js";
import type { SpaceColumn, SpaceItem } from "@/contracts";
import { dates } from "@valentinkolb/stdlib";
import { setDetailItemInUrl, shouldHandleDetailClick } from "../../../lib/detail";

type Props = {
  items: SpaceItem[];
  columns: SpaceColumn[];
  selectedItemId?: string;
  baseUrl: string;
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

function CellLink(props: {
  href: string;
  item: SpaceItem;
  class?: string;
  title?: string;
  tabIndex?: number;
  children: JSX.Element;
}) {
  return (
    <a
      href={props.href}
      tabIndex={props.tabIndex}
      class={props.class}
      title={props.title}
      onClick={(event) => {
        if (!shouldHandleDetailClick(event, event.currentTarget)) return;
        event.preventDefault();
        setDetailItemInUrl(props.item.id, props.item);
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

  return (
    <div class="paper overflow-hidden" style="view-transition-name: spaces-items-table">
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-zinc-100 dark:border-zinc-800">
              <th class="px-3 py-2 text-left font-medium text-dimmed">Title</th>
              <th class="px-3 py-2 text-left font-medium text-dimmed">Kanban</th>
              <th class="px-3 py-2 text-left font-medium text-dimmed">Kind</th>
              <th class="px-3 py-2 text-left font-medium text-dimmed">Priority</th>
              <th class="px-3 py-2 text-left font-medium text-dimmed">Schedule</th>
              <th class="px-3 py-2 text-left font-medium text-dimmed hidden xl:table-cell">Assignees</th>
              <th class="px-3 py-2 text-left font-medium text-dimmed hidden xl:table-cell">Tags</th>
              <th class="px-3 py-2 text-left font-medium text-dimmed whitespace-nowrap">Updated</th>
              <th class="px-3 py-2 text-left font-medium text-dimmed whitespace-nowrap hidden 2xl:table-cell">Created</th>
            </tr>
          </thead>
          <tbody>
            {props.items.map((item) => {
              const column = columnsById.get(item.columnId) ?? null;
              const isEvent = Boolean(item.startsAt && item.endsAt);
              const href = buildItemHref(props.baseUrl, item.id);
              return (
                <tr
                  class={`group border-b border-zinc-50 last:border-0 dark:border-zinc-800/50 ${
                    props.selectedItemId === item.id
                      ? "bg-blue-50/70 dark:bg-blue-950/20"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                  }`}
                >
                  <td class="p-0">
                    <CellLink
                      href={href}
                      item={item}
                      class={`block max-w-[24rem] truncate px-3 py-1.5 font-medium text-primary group-hover:underline ${
                        item.completedAt ? "line-through text-dimmed" : ""
                      }`}
                      title={item.title}
                    >
                      {item.title}
                    </CellLink>
                  </td>
                  <td class="p-0 whitespace-nowrap text-secondary">
                    <CellLink href={href} item={item} class="block px-3 py-1.5" tabIndex={-1}>
                      {column ? (
                        <span class="inline-flex items-center gap-1.5">
                          {column.color && <span class="h-2 w-2 rounded-full" style={`background-color:${column.color}`} />}
                          <span>{column.name}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </CellLink>
                  </td>
                  <td class="p-0 whitespace-nowrap text-secondary">
                    <CellLink href={href} item={item} class="block px-3 py-1.5" tabIndex={-1}>
                      {isEvent ? "Event" : "Task"}
                    </CellLink>
                  </td>
                  <td class="p-0 whitespace-nowrap">
                    <CellLink href={href} item={item} class="block px-3 py-1.5" tabIndex={-1}>
                      {item.priority ? (
                        <span class={`inline-flex items-center gap-1 ${PRIORITY_CLASS[item.priority] ?? "text-dimmed"}`}>
                          <i class="ti ti-flag text-sm" />
                          <span>{PRIORITY_LABEL[item.priority]}</span>
                        </span>
                      ) : (
                        <span class="text-dimmed">—</span>
                      )}
                    </CellLink>
                  </td>
                  <td class="p-0 text-secondary max-w-[18rem]">
                    <CellLink href={href} item={item} class="block truncate px-3 py-1.5" title={formatSchedule(item)} tabIndex={-1}>
                      {formatSchedule(item)}
                    </CellLink>
                  </td>
                  <td class="p-0 hidden xl:table-cell">
                    <CellLink
                      href={href}
                      item={item}
                      class="block max-w-[14rem] truncate px-3 py-1.5 text-secondary"
                      title={item.assignees?.map((assignee) => assignee.displayName).join(", ") || "—"}
                      tabIndex={-1}
                    >
                      {item.assignees && item.assignees.length > 0 ? item.assignees.map((assignee) => assignee.displayName).join(", ") : "—"}
                    </CellLink>
                  </td>
                  <td class="p-0 hidden xl:table-cell">
                    <CellLink
                      href={href}
                      item={item}
                      class="block max-w-[12rem] truncate px-3 py-1.5 text-secondary"
                      title={item.tags?.map((tag) => tag.name).join(", ") || "—"}
                      tabIndex={-1}
                    >
                      {item.tags && item.tags.length > 0 ? item.tags.map((tag) => tag.name).join(", ") : "—"}
                    </CellLink>
                  </td>
                  <td class="p-0 whitespace-nowrap text-dimmed">
                    <CellLink href={href} item={item} class="block px-3 py-1.5" tabIndex={-1}>
                      {dates.formatDateTime(item.updatedAt)}
                    </CellLink>
                  </td>
                  <td class="p-0 whitespace-nowrap text-dimmed hidden 2xl:table-cell">
                    <CellLink href={href} item={item} class="block px-3 py-1.5" tabIndex={-1}>
                      {dates.formatDateTime(item.createdAt)}
                    </CellLink>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
