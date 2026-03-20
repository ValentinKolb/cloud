import type { SpaceItem, SpaceColumn, SpaceTag, ItemGroupBy } from "@/spaces/contracts";
import ItemRow from "./ItemRow.island";

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
function getDeadlineGroupKey(item: SpaceItem): string {
  if (!item.deadline) return "none";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const deadline = new Date(item.deadline);
  const deadlineDate = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());

  const isCompleted = !!item.completedAt;
  if (deadlineDate < today && !isCompleted) return "overdue";
  if (deadlineDate.getTime() === today.getTime()) return "today";
  if (deadlineDate.getTime() === tomorrow.getTime()) return "tomorrow";
  if (deadlineDate < weekEnd) return "thisWeek";
  return "later";
}

/** Group items by the specified criteria */
function groupItems(
  items: SpaceItem[],
  groupBy: ItemGroupBy,
  columns: SpaceColumn[],
  tags: SpaceTag[],
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
        const key = getDeadlineGroupKey(item);
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
  const { groups, itemsByGroup } = groupItems(props.items, props.groupBy, props.columns, props.tags);

  const visibleGroups = groups;

  // Flat list - no grouping container
  if (props.groupBy === "none") {
    return (
      <div class="flex flex-col gap-1">
        {props.items.map((item) => (
          <ItemRow item={item} spaceId={props.spaceId} isSelected={item.id === props.selectedItemId} baseUrl={props.baseUrl} />
        ))}
      </div>
    );
  }

  // Grouped list — filter out empty groups
  const nonEmptyGroups = visibleGroups.filter((g) => (itemsByGroup[g.key] || []).length > 0);

  return (
    <div class="flex flex-col gap-2">
      {nonEmptyGroups.map((group) => {
        const groupItems = itemsByGroup[group.key]!;
        return (
          <div class="rounded-lg bg-zinc-50/50 dark:bg-zinc-800/30">
            <GroupHeader config={group} count={groupItems.length} />
            <div class="flex flex-col gap-1 p-2">
              {groupItems.map((item) => (
                <ItemRow item={item} spaceId={props.spaceId} isSelected={item.id === props.selectedItemId} baseUrl={props.baseUrl} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
