import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import type {
  AssignedToFilter,
  DeadlineFilter,
  ItemGroupBy,
  ItemSort,
  ItemStatus,
  ItemType,
  Priority,
  SpaceColumn,
  SpaceTag,
} from "@/contracts";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";
import SearchInput from "./SearchInput";
import { buildFilterUrl, defaultFilter, type FilterState, hasActiveFilters } from "./types";

type FilterBarProps = {
  spaceId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  filter: FilterState;
  total: number;
  baseUrl: string;
  hideGroupBy?: boolean;
  onFilterChange?: (patch: Partial<FilterState>) => void;
  onSearchChange?: (search: string) => void | Promise<void>;
  onClearFilters?: () => void;
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
      { value: "sort:column", label: "Status", icon: "ti ti-layout-kanban" },
      { value: "sort:deadline", label: "Schedule", icon: "ti ti-calendar-time" },
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
      { value: "column", label: "Status", icon: "ti ti-layout-kanban" },
      { value: "priority", label: "Priority", icon: "ti ti-flag" },
      { value: "tag", label: "Tag", icon: "ti ti-tag" },
      { value: "deadline", label: "Schedule", icon: "ti ti-calendar-time" },
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
  const navigate = (params: Partial<FilterState>) => {
    if (props.onFilterChange) {
      props.onFilterChange(params);
      return;
    }
    requestSpacesRouteNavigation(buildFilterUrl(props.baseUrl, { ...params, page: 1 }, props.filter));
  };

  const clearFilters = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (props.onClearFilters) {
      props.onClearFilters();
      return;
    }
    requestSpacesRouteNavigation(buildFilterUrl(props.baseUrl, defaultFilter, defaultFilter));
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
        ...props.filter,
        groupBy: defaultFilter.groupBy,
      })
    : hasActiveFilters(props.filter);

  return (
    <div class="flex flex-col gap-2" style="view-transition-name: filter-bar">
      <SearchInput value={props.filter.search} baseUrl={buildFilterUrl(props.baseUrl, {}, props.filter)} onSearch={props.onSearchChange} />

      <div class="no-scrollbar flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
        {/* Scope: item type + completion state + assignment */}
        <FilterChip
          label="Scope"
          icon="ti ti-filter"
          options={VIEW_OPTIONS}
          value={[`type:${props.filter.type}`, `status:${props.filter.status}`, `assigned:${props.filter.assignedTo}`]}
          onChange={(v) => {
            const type = (v.find((x) => x.startsWith("type:"))?.slice(5) ?? defaultFilter.type) as ItemType;
            const status = (v.find((x) => x.startsWith("status:"))?.slice(7) ?? defaultFilter.status) as ItemStatus;
            const assignedTo = (v.find((x) => x.startsWith("assigned:"))?.slice(9) ?? defaultFilter.assignedTo) as AssignedToFilter;
            navigate({ type, status, assignedTo });
          }}
          isActive={
            props.filter.type !== defaultFilter.type ||
            props.filter.status !== defaultFilter.status ||
            props.filter.assignedTo !== defaultFilter.assignedTo
          }
          defaultValue={VIEW_DEFAULT}
        />

        {/* Priority */}
        <FilterChip
          label="Priority"
          icon="ti ti-flag"
          options={PRIORITY_OPTIONS}
          value={props.filter.priority}
          onChange={(v) => navigate({ priority: v as Priority[] })}
        />

        {/* Deadline */}
        <FilterChip
          label="Deadline"
          icon="ti ti-clock"
          options={DEADLINE_OPTIONS}
          value={[props.filter.deadlineFilter]}
          onChange={(v) => navigate({ deadlineFilter: (v[0] ?? "all") as DeadlineFilter })}
          isActive={props.filter.deadlineFilter !== defaultFilter.deadlineFilter}
          defaultValue={[defaultFilter.deadlineFilter]}
        />

        {/* Tags */}
        {props.tags.length > 0 && (
          <FilterChip
            label="Tags"
            icon="ti ti-tag"
            options={tagOptions()}
            value={props.filter.tagIds}
            onChange={(v) => navigate({ tagIds: v })}
          />
        )}

        {/* Workflow status */}
        <div class="shrink-0">
          <FilterChip
            label="Status"
            icon="ti ti-layout-kanban"
            options={columnOptions()}
            value={props.filter.columnIds}
            onChange={(v) => navigate({ columnIds: v })}
          />
        </div>

        {/* Sort */}
        <div class="shrink-0">
          <FilterChip
            label="Sort"
            icon="ti ti-arrows-sort"
            options={SORT_OPTIONS}
            value={[`sort:${props.filter.sort}`, `dir:${props.filter.sortDesc ? "desc" : "asc"}`]}
            onChange={(v) => {
              const sort = (v.find((x) => x.startsWith("sort:"))?.slice(5) ?? defaultFilter.sort) as ItemSort;
              const sortDesc = v.includes("dir:desc");
              navigate({ sort, sortDesc });
            }}
            isActive={props.filter.sort !== defaultFilter.sort || props.filter.sortDesc !== defaultFilter.sortDesc}
            defaultValue={SORT_DEFAULT}
          />
        </div>

        {/* Group By */}
        {!props.hideGroupBy && (
          <div class="shrink-0">
            <FilterChip
              label="Group By"
              icon="ti ti-layout-list"
              options={GROUP_BY_OPTIONS}
              value={[props.filter.groupBy]}
              onChange={(v) =>
                navigate({
                  groupBy: (v[0] ?? defaultFilter.groupBy) as ItemGroupBy,
                })
              }
              isActive={props.filter.groupBy !== defaultFilter.groupBy}
              defaultValue={[defaultFilter.groupBy]}
            />
          </div>
        )}

        {/* Clear Filters */}
        {hasFilters && (
          <a
            href={buildFilterUrl(props.baseUrl, defaultFilter, defaultFilter)}
            onClick={clearFilters}
            class="btn-simple btn-sm shrink-0"
            aria-label="Clear all filters"
          >
            <i class="ti ti-x" />
            <span class="hidden sm:inline">Clear</span>
          </a>
        )}

        <span class="shrink-0 whitespace-nowrap text-xs text-dimmed">
          {props.filter.search && `Results for "${props.filter.search}": `}
          {props.total === 0 ? "No items" : props.total === 1 ? "1 item" : `${props.total} items`}
          {hasFilters && !props.filter.search && " (filtered)"}
        </span>
      </div>
    </div>
  );
}
