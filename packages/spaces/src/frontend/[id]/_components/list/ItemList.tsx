import { type DateContext, dates } from "@valentinkolb/stdlib";
import { createMemo } from "solid-js";
import type { ItemGroupBy, SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import ItemRow from "./ItemRow";

// =============================================================================
// Types
// =============================================================================

type GroupConfig = {
  key: string;
  label: string;
  icon?: string;
  color?: string;
};

type ItemListProps = {
  items: SpaceItem[];
  columns: SpaceColumn[];
  tags: SpaceTag[];
  spaceId: string;
  selectedItemId?: string;
  groupBy: ItemGroupBy;
  showCompleted?: boolean;
  baseUrl: string;
  dateConfig?: DateContext;
};

// =============================================================================
// Group Definitions
// =============================================================================

const PRIORITY_GROUPS: GroupConfig[] = [
  { key: "urgent", label: "Urgent", icon: "ti-alert-circle", color: "#ef4444" },
  { key: "high", label: "High", icon: "ti-arrow-up", color: "#f97316" },
  { key: "medium", label: "Medium", icon: "ti-minus", color: "#eab308" },
  { key: "low", label: "Low", icon: "ti-arrow-down", color: "#3b82f6" },
  { key: "none", label: "No Priority", icon: "ti-circle", color: "#6b7280" },
];

const DEADLINE_GROUPS: GroupConfig[] = [
  {
    key: "overdue",
    label: "Overdue",
    icon: "ti-alert-triangle",
    color: "#ef4444",
  },
  { key: "today", label: "Today", icon: "ti-calendar-due", color: "#f97316" },
  {
    key: "tomorrow",
    label: "Tomorrow",
    icon: "ti-calendar-event",
    color: "#eab308",
  },
  {
    key: "thisWeek",
    label: "This Week",
    icon: "ti-calendar-week",
    color: "#3b82f6",
  },
  { key: "later", label: "Later", icon: "ti-calendar", color: "#6b7280" },
  {
    key: "none",
    label: "No Deadline",
    icon: "ti-calendar-off",
    color: "#9ca3af",
  },
];

// =============================================================================
// Grouping Functions
// =============================================================================

/** Get deadline group key for an item */
function getDeadlineGroupKey(item: SpaceItem, dateConfig?: DateContext): string {
  if (!item.deadline) return "none";

  const today = dates.today(dateConfig);
  const tomorrow = dates.addDays(today, 1, dateConfig);
  const weekEnd = dates.addDays(today, 7, dateConfig);
  const todayKey = dates.formatDateKey(today, dateConfig);
  const tomorrowKey = dates.formatDateKey(tomorrow, dateConfig);
  const weekEndKey = dates.formatDateKey(weekEnd, dateConfig);
  const deadlineKey = dates.formatDateKey(item.deadline, dateConfig);

  const isCompleted = !!item.completedAt;
  if (deadlineKey < todayKey && !isCompleted) return "overdue";
  if (deadlineKey === todayKey) return "today";
  if (deadlineKey === tomorrowKey) return "tomorrow";
  if (deadlineKey < weekEndKey) return "thisWeek";
  return "later";
}

/** Group items by the specified criteria */
function groupItems(
  items: SpaceItem[],
  groupBy: ItemGroupBy,
  columns: SpaceColumn[],
  tags: SpaceTag[],
  dateConfig?: DateContext,
): { groups: GroupConfig[]; itemsByGroup: Record<string, SpaceItem[]> } {
  const itemsByGroup: Record<string, SpaceItem[]> = {};

  switch (groupBy) {
    case "none": {
      // Flat list - single group
      return {
        groups: [{ key: "all", label: "" }],
        itemsByGroup: { all: items },
      };
    }

    case "column": {
      // Group by Kanban column
      const groups: GroupConfig[] = columns.map((c) => ({
        key: c.id,
        label: c.name,
        color: c.color || "#6b7280",
      }));

      for (const col of columns) {
        itemsByGroup[col.id] = [];
      }
      for (const item of items) {
        itemsByGroup[item.columnId]?.push(item);
      }
      return { groups, itemsByGroup };
    }

    case "priority": {
      for (const g of PRIORITY_GROUPS) {
        itemsByGroup[g.key] = [];
      }
      for (const item of items) {
        const key = item.priority ?? "none";
        itemsByGroup[key]?.push(item);
      }
      return { groups: PRIORITY_GROUPS, itemsByGroup };
    }

    case "tag": {
      // Group by tag (items with multiple tags appear in each)
      const groups: GroupConfig[] = [
        ...tags.map((t) => ({ key: t.id, label: t.name, color: t.color })),
        {
          key: "none",
          label: "No Tag",
          icon: "ti-tag-off",
          color: "#6b7280",
        },
      ];

      for (const tag of tags) {
        itemsByGroup[tag.id] = [];
      }
      itemsByGroup["none"] = [];

      for (const item of items) {
        if (!item.tags || item.tags.length === 0) {
          itemsByGroup["none"]?.push(item);
        } else {
          for (const tag of item.tags) {
            itemsByGroup[tag.id]?.push(item);
          }
        }
      }
      return { groups, itemsByGroup };
    }

    case "deadline": {
      for (const g of DEADLINE_GROUPS) {
        itemsByGroup[g.key] = [];
      }
      for (const item of items) {
        const key = getDeadlineGroupKey(item, dateConfig);
        itemsByGroup[key]?.push(item);
      }
      return { groups: DEADLINE_GROUPS, itemsByGroup };
    }

    default:
      return { groups: [], itemsByGroup: {} };
  }
}

// =============================================================================
// Group Header Component
// =============================================================================

function GroupHeader(props: { config: GroupConfig; count: number }) {
  // Flat list has no header
  if (!props.config.label) return null;

  return (
    <div class="px-4 py-2 flex items-center gap-2">
      {/* Icon or color dot */}
      {props.config.icon && !props.config.color?.startsWith("#") && <i class={`ti ${props.config.icon} text-sm text-dimmed`} />}
      {props.config.color && !props.config.icon && (
        <div class="w-3 h-3 rounded-full shrink-0" style={`background-color: ${props.config.color}`} />
      )}
      {props.config.icon && props.config.color && <i class={`ti ${props.config.icon} text-sm`} style={`color: ${props.config.color}`} />}

      <span class="font-medium text-sm">{props.config.label}</span>
      <span class="text-xs text-dimmed">({props.count})</span>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Unified item list with configurable grouping.
 * Renders items grouped by column, priority, tag, deadline, or flat.
 */
export default function ItemList(props: ItemListProps) {
  const grouped = createMemo(() => groupItems(props.items, props.groupBy, props.columns, props.tags, props.dateConfig));
  const nonEmptyGroups = createMemo(() => {
    const current = grouped();
    return current.groups.filter((group) => (current.itemsByGroup[group.key] || []).length > 0);
  });

  return (
    <>
      {props.groupBy === "none" ? (
        <div class="flex flex-col gap-1">
          {props.items.map((item) => (
            <ItemRow
              item={item}
              spaceId={props.spaceId}
              columns={props.columns}
              tags={props.tags}
              isSelected={item.id === props.selectedItemId}
              baseUrl={props.baseUrl}
              dateConfig={props.dateConfig}
            />
          ))}
        </div>
      ) : (
        <div class="flex flex-col gap-2">
          {nonEmptyGroups().map((group) => {
            const items = grouped().itemsByGroup[group.key] ?? [];
            return (
              <div class="rounded-lg bg-zinc-100/60 [box-shadow:var(--theme-recess)] dark:bg-zinc-950/40">
                <GroupHeader config={group} count={items.length} />
                <div class="flex flex-col gap-1 p-2">
                  {items.map((item) => (
                    <ItemRow
                      item={item}
                      spaceId={props.spaceId}
                      columns={props.columns}
                      tags={props.tags}
                      isSelected={item.id === props.selectedItemId}
                      baseUrl={props.baseUrl}
                      dateConfig={props.dateConfig}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
