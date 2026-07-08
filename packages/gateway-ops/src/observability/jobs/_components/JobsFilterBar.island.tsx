import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import {
  buildJobsFilterUrl,
  defaultJobsFilter,
  hasActiveJobsFilters,
  type JobsFilterState,
  jobsDurationOptions,
  jobsWindowOptions,
} from "./types";

type Props = {
  filter: JobsFilterState;
};

const baseUrl = "/admin/observability/jobs";

const windowOptions: FilterChipSection[] = [
  {
    options: jobsWindowOptions.map((option) => ({ value: option.value, label: option.label, icon: "ti ti-clock" })),
  },
];

const healthOptions: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All states", icon: "ti ti-list" },
      { value: "failed", label: "Failed", icon: "ti ti-alert-circle" },
      { value: "running", label: "Running", icon: "ti ti-loader" },
      { value: "healthy", label: "Healthy", icon: "ti ti-check" },
    ],
  },
];

const typeOptions: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All types", icon: "ti ti-stack-2" },
      { value: "job", label: "Jobs", icon: "ti ti-briefcase" },
      { value: "schedule", label: "Schedules", icon: "ti ti-calendar-time" },
      { value: "ai", label: "AI", icon: "ti ti-sparkles" },
      { value: "sync", label: "Sync", icon: "ti ti-refresh" },
      { value: "notification", label: "Notifications", icon: "ti ti-bell" },
      { value: "http", label: "HTTP", icon: "ti ti-world" },
      { value: "custom", label: "Custom", icon: "ti ti-settings" },
    ],
  },
];

const durationOptions: FilterChipSection[] = [
  {
    options: jobsDurationOptions.map((option) => ({ value: option.value, label: option.label, icon: "ti ti-hourglass" })),
  },
];

export default function JobsFilterBar(props: Props) {
  const navigate = (updates: Partial<JobsFilterState>) => {
    navigateTo(buildJobsFilterUrl(baseUrl, { ...updates, page: 1, run: null }, props.filter));
  };

  const searchAction = buildJobsFilterUrl(
    baseUrl,
    {
      search: "",
      page: 1,
      run: null,
    },
    props.filter,
  );
  const clearUrl = buildJobsFilterUrl(
    baseUrl,
    {
      window: defaultJobsFilter.window,
      health: defaultJobsFilter.health,
      type: defaultJobsFilter.type,
      duration: defaultJobsFilter.duration,
      search: "",
      run: null,
      page: 1,
    },
    props.filter,
  );

  return (
    <div class="flex flex-col gap-2">
      <SearchBar action={searchAction} value={props.filter.search} placeholder="Search sources, jobs, app ids, or span keys..." />
      <div class="flex items-center gap-2 flex-wrap">
        <FilterChip
          label="Window"
          icon="ti ti-clock"
          options={windowOptions}
          value={[props.filter.window]}
          onChange={(value) => navigate({ window: (value[0] as JobsFilterState["window"]) ?? defaultJobsFilter.window })}
          isActive={props.filter.window !== defaultJobsFilter.window}
          defaultValue={[defaultJobsFilter.window]}
        />
        <FilterChip
          label="Health"
          icon="ti ti-filter"
          options={healthOptions}
          value={[props.filter.health]}
          onChange={(value) => navigate({ health: (value[0] as JobsFilterState["health"]) ?? defaultJobsFilter.health })}
          isActive={props.filter.health !== defaultJobsFilter.health}
          defaultValue={[defaultJobsFilter.health]}
        />
        <FilterChip
          label="Type"
          icon="ti ti-stack-2"
          options={typeOptions}
          value={[props.filter.type]}
          onChange={(value) => navigate({ type: (value[0] as JobsFilterState["type"]) ?? defaultJobsFilter.type })}
          isActive={props.filter.type !== defaultJobsFilter.type}
          defaultValue={[defaultJobsFilter.type]}
        />
        <FilterChip
          label="Duration"
          icon="ti ti-hourglass"
          options={durationOptions}
          value={[props.filter.duration]}
          onChange={(value) => navigate({ duration: (value[0] as JobsFilterState["duration"]) ?? defaultJobsFilter.duration })}
          isActive={props.filter.duration !== defaultJobsFilter.duration}
          defaultValue={[defaultJobsFilter.duration]}
        />
        {hasActiveJobsFilters(props.filter) && (
          <a
            href={clearUrl}
            class="text-[10px] text-red-500 tabular-nums hidden sm:inline"
            aria-label="Clear all filters"
            title="Clear filters"
          >
            <i class="ti ti-x" /> Clear
          </a>
        )}
      </div>
    </div>
  );
}
