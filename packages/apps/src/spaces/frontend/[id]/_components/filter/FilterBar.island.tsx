import type {
  SpaceColumn,
  SpaceTag,
  Priority,
  ItemType,
  ItemStatus,
  DeadlineFilter,
  ItemSort,
  ItemGroupBy,
  AssignedToFilter,
} from "@/spaces/contracts";
import { onMount } from "solid-js";
import { type FilterState, defaultFilter, buildFilterUrl, hasActiveFilters } from "./types";
import { setLastSpaceId } from "../settings/SpaceSettingsStore";
import SearchInput from "./SearchInput.island";
import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/lib/ui";

type FilterBarProps = {
  spaceId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  filter: FilterState;
  total: number;
  baseUrl: string;
  hideGroupBy?: boolean;
};

// Static filter options (defined outside component to avoid recreation)
const VIEW_OPTIONS: FilterChipSection[] = [
  {
    label: "Type",
    options: [
      { value: "type:all", label: "All", icon: "ti ti-list" },
      { value: "type:task", label: "Tasks", icon: "ti ti-checkbox" },
      { value: "type:event", label: "Events", icon: "ti ti-calendar-event" },
    ],
  },
  {
    label: "Status",
    options: [
      { value: "status:active", label: "Active", icon: "ti ti-circle" },
      { value: "status:completed", label: "Done", icon: "ti ti-circle-check" },
      { value: "status:all", label: "All", icon: "ti ti-list" },
    ],
  },
  {
    label: "Assigned to",
    options: [
      { value: "assigned:all", label: "All", icon: "ti ti-users" },
      {
        value: "assigned:assigned",
        label: "Assigned",
        icon: "ti ti-user-check",
      },
      { value: "assigned:me", label: "Me", icon: "ti ti-user" },
      {
        value: "assigned:unassigned",
        label: "Unassigned",
        icon: "ti ti-user-off",
      },
    ],
  },
];

const PRIORITY_OPTIONS: FilterChipSection[] = [
  {
    multiple: true,
    options: [
      { value: "urgent", label: "Urgent", color: "#ef4444" },
      { value: "high", label: "High", color: "#f97316" },
      { value: "medium", label: "Medium", color: "#eab308" },
      { value: "low", label: "Low", color: "#3b82f6" },
    ],
  },
];

const DEADLINE_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All", icon: "ti ti-calendar" },
      { value: "overdue", label: "Overdue", icon: "ti ti-alert-triangle" },
      { value: "today", label: "Today", icon: "ti ti-calendar-due" },
      { value: "week", label: "This week", icon: "ti ti-calendar-week" },
      { value: "none", label: "No deadline", icon: "ti ti-calendar-off" },
    ],
  },
];

const SORT_OPTIONS: FilterChipSection[] = [
  {
    label: "Sort by",
    options: [
      { value: "sort:column", label: "Kanban", icon: "ti ti-layout-kanban" },
      { value: "sort:deadline", label: "Deadline", icon: "ti ti-clock" },
      { value: "sort:priority", label: "Priority", icon: "ti ti-flag" },
      { value: "sort:created", label: "Created", icon: "ti ti-calendar-plus" },
      { value: "sort:updated", label: "Updated", icon: "ti ti-history" },
      {
        value: "sort:title",
        label: "Title",
        icon: "ti ti-sort-ascending-letters",
      },
    ],
  },
  {
    label: "Direction",
    options: [
      { value: "dir:asc", label: "Ascending", icon: "ti ti-sort-ascending" },
      { value: "dir:desc", label: "Descending", icon: "ti ti-sort-descending" },
    ],
  },
];

const GROUP_BY_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "none", label: "None", icon: "ti ti-list" },
      { value: "column", label: "Kanban", icon: "ti ti-layout-kanban" },
      { value: "priority", label: "Priority", icon: "ti ti-flag" },
      { value: "tag", label: "Tag", icon: "ti ti-tag" },
      { value: "deadline", label: "Deadline", icon: "ti ti-clock" },
    ],
  },
];

// Default values for reset
const VIEW_DEFAULT = [`type:${defaultFilter.type}`, `status:${defaultFilter.status}`, `assigned:${defaultFilter.assignedTo}`];
const SORT_DEFAULT = [`sort:${defaultFilter.sort}`, `dir:asc`];

/**
 * Filter bar for the items list.
 */
export default function FilterBar(props: FilterBarProps) {
  onMount(() => setLastSpaceId(props.spaceId));

  const { filter } = props;

  const navigate = (params: Partial<FilterState>) => {
    window.location.href = buildFilterUrl(props.baseUrl, { ...params, page: 1 }, filter);
  };

  // Dynamic options based on props
  const tagOptions = (): FilterChipSection[] => [
    {
      multiple: true,
      options: props.tags.map((t) => ({
        value: t.id,
        label: t.name,
        color: t.color,
      })),
    },
  ];

  const columnOptions = (): FilterChipSection[] => [
    {
      multiple: true,
      options: props.columns.map((c) => ({
        value: c.id,
        label: c.name,
        color: c.color ?? undefined,
      })),
    },
  ];

  const hasFilters = props.hideGroupBy
    ? hasActiveFilters({
        ...filter,
        groupBy: defaultFilter.groupBy,
      })
    : hasActiveFilters(filter);

  return (
    <div class="flex flex-col gap-2" style="view-transition-name: filter-bar">
      <SearchInput value={filter.search} baseUrl={buildFilterUrl(props.baseUrl, {}, filter)} />

      <div class="flex flex-wrap items-center gap-2">
        {/* View: Type + Status + Assigned To */}
        <FilterChip
          label="View"
          icon="ti ti-filter"
          options={VIEW_OPTIONS}
          value={[`type:${filter.type}`, `status:${filter.status}`, `assigned:${filter.assignedTo}`]}
          onChange={(v) => {
            const type = (v.find((x) => x.startsWith("type:"))?.slice(5) ?? defaultFilter.type) as ItemType;
            const status = (v.find((x) => x.startsWith("status:"))?.slice(7) ?? defaultFilter.status) as ItemStatus;
            const assignedTo = (v.find((x) => x.startsWith("assigned:"))?.slice(9) ?? defaultFilter.assignedTo) as AssignedToFilter;
            navigate({ type, status, assignedTo });
          }}
          isActive={
            filter.type !== defaultFilter.type || filter.status !== defaultFilter.status || filter.assignedTo !== defaultFilter.assignedTo
          }
          defaultValue={VIEW_DEFAULT}
        />

        {/* Priority */}
        <FilterChip
          label="Priority"
          icon="ti ti-flag"
          options={PRIORITY_OPTIONS}
          value={filter.priority}
          onChange={(v) => navigate({ priority: v as Priority[] })}
        />

        {/* Deadline */}
        <FilterChip
          label="Deadline"
          icon="ti ti-clock"
          options={DEADLINE_OPTIONS}
          value={[filter.deadlineFilter]}
          onChange={(v) => navigate({ deadlineFilter: (v[0] ?? "all") as DeadlineFilter })}
          isActive={filter.deadlineFilter !== defaultFilter.deadlineFilter}
          defaultValue={[defaultFilter.deadlineFilter]}
        />

        {/* Tags */}
        {props.tags.length > 0 && (
          <FilterChip
            label="Tags"
            icon="ti ti-tag"
            options={tagOptions()}
            value={filter.tagIds}
            onChange={(v) => navigate({ tagIds: v })}
          />
        )}

        {/* Columns */}
        <div class="hidden lg:block">
          <FilterChip
            label="Kanban"
            icon="ti ti-layout-kanban"
            options={columnOptions()}
            value={filter.columnIds}
            onChange={(v) => navigate({ columnIds: v })}
          />
        </div>

        {/* Sort */}
        <div class="hidden md:block">
          <FilterChip
            label="Sort"
            icon="ti ti-arrows-sort"
            options={SORT_OPTIONS}
            value={[`sort:${filter.sort}`, `dir:${filter.sortDesc ? "desc" : "asc"}`]}
            onChange={(v) => {
              const sort = (v.find((x) => x.startsWith("sort:"))?.slice(5) ?? defaultFilter.sort) as ItemSort;
              const sortDesc = v.includes("dir:desc");
              navigate({ sort, sortDesc });
            }}
            isActive={filter.sort !== defaultFilter.sort || filter.sortDesc !== defaultFilter.sortDesc}
            defaultValue={SORT_DEFAULT}
          />
        </div>

        {/* Group By */}
        {!props.hideGroupBy && (
          <div class="hidden lg:block">
            <FilterChip
              label="Group By"
              icon="ti ti-layout-list"
              options={GROUP_BY_OPTIONS}
              value={[filter.groupBy]}
              onChange={(v) =>
                navigate({
                  groupBy: (v[0] ?? defaultFilter.groupBy) as ItemGroupBy,
                })
              }
              isActive={filter.groupBy !== defaultFilter.groupBy}
              defaultValue={[defaultFilter.groupBy]}
            />
          </div>
        )}

        {/* Clear Filters */}
        {hasFilters && (
          <a
            href={buildFilterUrl(props.baseUrl, defaultFilter, defaultFilter)}
            class="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            aria-label="Clear all filters"
          >
            <i class="ti ti-x" />
            <span class="hidden sm:inline">Clear</span>
          </a>
        )}

        <span class="text-xs text-dimmed whitespace-nowrap">
          {filter.search && `Results for "${filter.search}": `}
          {props.total === 0 ? "No items" : props.total === 1 ? "1 item" : `${props.total} items`}
          {hasFilters && !filter.search && " (filtered)"}
        </span>
      </div>
    </div>
  );
}
