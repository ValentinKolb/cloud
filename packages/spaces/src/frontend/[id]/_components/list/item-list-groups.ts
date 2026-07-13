import { type DateContext, dates } from "@valentinkolb/stdlib";
import type { ItemGroupBy, SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";

export type ItemListGroup = {
  key: string;
  label: string;
  icon?: string;
  color?: string;
  meta?: string;
};

const PRIORITY_GROUPS: ItemListGroup[] = [
  { key: "urgent", label: "Urgent", icon: "ti-alert-circle", color: "#ef4444" },
  { key: "high", label: "High", icon: "ti-arrow-up", color: "#f97316" },
  { key: "medium", label: "Medium", icon: "ti-minus", color: "#eab308" },
  { key: "low", label: "Low", icon: "ti-arrow-down", color: "#3b82f6" },
  { key: "none", label: "No Priority", icon: "ti-circle", color: "#6b7280" },
];

/** Events use their start, tasks use their deadline. */
export const getEffectiveSchedule = (item: SpaceItem): string | null => (item.startsAt && item.endsAt ? item.startsAt : item.deadline);

const scheduleGroup = (item: SpaceItem, dateConfig?: DateContext): ItemListGroup => {
  const schedule = getEffectiveSchedule(item);
  if (!schedule) {
    return { key: "none", label: "No date", icon: "ti-calendar-off", color: "#9ca3af" };
  }

  const today = dates.today(dateConfig);
  const tomorrow = dates.addDays(today, 1, dateConfig);
  const todayKey = dates.formatDateKey(today, dateConfig);
  const tomorrowKey = dates.formatDateKey(tomorrow, dateConfig);
  const scheduleKey = dates.formatDateKey(schedule, dateConfig);

  if (scheduleKey < todayKey && !item.completedAt) {
    if (item.startsAt && item.endsAt) {
      return { key: "past-events", label: "Past events", icon: "ti-history", color: "#6b7280" };
    }
    return { key: "overdue", label: "Overdue", icon: "ti-alert-triangle", color: "#ef4444" };
  }

  const date = new Date(schedule);
  if (scheduleKey === todayKey) {
    return { key: `date:${scheduleKey}`, label: "Today", icon: "ti-sun", meta: dates.formatDate(date, dateConfig) };
  }
  if (scheduleKey === tomorrowKey) {
    return { key: `date:${scheduleKey}`, label: "Tomorrow", icon: "ti-sunrise", meta: dates.formatDate(date, dateConfig) };
  }
  return {
    key: `date:${scheduleKey}`,
    label: dates.formatWeekdayLong(date, dateConfig),
    icon: "ti-calendar",
    meta: dates.formatDate(date, dateConfig),
  };
};

const groupBySchedule = (items: SpaceItem[], dateConfig?: DateContext) => {
  const groups: ItemListGroup[] = [];
  const itemsByGroup: Record<string, SpaceItem[]> = {};

  for (const item of items) {
    const group = scheduleGroup(item, dateConfig);
    if (!itemsByGroup[group.key]) {
      groups.push(group);
      itemsByGroup[group.key] = [];
    }
    itemsByGroup[group.key]?.push(item);
  }

  return { groups, itemsByGroup };
};

export function groupItems(
  items: SpaceItem[],
  groupBy: ItemGroupBy,
  columns: SpaceColumn[],
  tags: SpaceTag[],
  dateConfig?: DateContext,
): { groups: ItemListGroup[]; itemsByGroup: Record<string, SpaceItem[]> } {
  const itemsByGroup: Record<string, SpaceItem[]> = {};

  switch (groupBy) {
    case "none":
      return { groups: [{ key: "all", label: "" }], itemsByGroup: { all: items } };
    case "column": {
      const groups = columns.map((column) => ({
        key: column.id,
        label: column.name,
        color: column.color || "#6b7280",
      }));
      for (const column of columns) itemsByGroup[column.id] = [];
      for (const item of items) itemsByGroup[item.columnId]?.push(item);
      return { groups, itemsByGroup };
    }
    case "priority":
      for (const group of PRIORITY_GROUPS) itemsByGroup[group.key] = [];
      for (const item of items) itemsByGroup[item.priority ?? "none"]?.push(item);
      return { groups: PRIORITY_GROUPS, itemsByGroup };
    case "tag": {
      const groups: ItemListGroup[] = [
        ...tags.map((tag) => ({ key: tag.id, label: tag.name, color: tag.color })),
        { key: "none", label: "No Tag", icon: "ti-tag-off", color: "#6b7280" },
      ];
      for (const tag of tags) itemsByGroup[tag.id] = [];
      itemsByGroup.none = [];
      for (const item of items) {
        if (!item.tags || item.tags.length === 0) itemsByGroup.none?.push(item);
        else for (const tag of item.tags) itemsByGroup[tag.id]?.push(item);
      }
      return { groups, itemsByGroup };
    }
    case "deadline":
      return groupBySchedule(items, dateConfig);
    default:
      return { groups: [], itemsByGroup: {} };
  }
}
