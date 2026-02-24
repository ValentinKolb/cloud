import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { type LogFilterState, defaultLogFilter, buildLogFilterUrl, hasActiveLogFilters } from "./types";

type LogFilterBarProps = {
  filter: LogFilterState;
  sources: string[];
  total: number;
};

const LEVEL_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All", icon: "ti ti-list" },
      { value: "debug", label: "Debug", icon: "ti ti-bug" },
      { value: "info", label: "Info", icon: "ti ti-info-circle" },
      { value: "warn", label: "Warn", icon: "ti ti-alert-triangle" },
      { value: "error", label: "Error", icon: "ti ti-alert-circle" },
    ],
  },
];

const LogFilterBar = (props: LogFilterBarProps) => {
  const baseUrl = "/admin/logs";
  const { filter } = props;

  const navigate = (params: Partial<LogFilterState>) => {
    window.location.href = buildLogFilterUrl(baseUrl, { ...params, page: 1 }, filter);
  };

  const sourceOptions = (): FilterChipSection[] => [
    {
      options: [
        { value: "all", label: "All", icon: "ti ti-list" },
        ...props.sources.map((s) => ({
          value: s,
          label: s,
          icon: "ti ti-code",
        })),
      ],
    },
  ];

  const hasFilters = hasActiveLogFilters(filter);

  return (
    <div class="flex flex-col gap-2">
      <SearchBar placeholder="Search logs..." ariaLabel="Search logs" />

      <div class="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Level"
          icon="ti ti-filter"
          options={LEVEL_OPTIONS}
          value={[filter.level]}
          onChange={(v) => navigate({ level: v[0] ?? "all" })}
          isActive={filter.level !== defaultLogFilter.level}
          defaultValue={[defaultLogFilter.level]}
        />

        {props.sources.length > 0 && (
          <FilterChip
            label="Source"
            icon="ti ti-code"
            options={sourceOptions()}
            value={[filter.source]}
            onChange={(v) => navigate({ source: v[0] ?? "all" })}
            isActive={filter.source !== defaultLogFilter.source}
            defaultValue={[defaultLogFilter.source]}
          />
        )}

        {hasFilters && (
          <a
            href={baseUrl}
            class="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            aria-label="Clear all filters"
          >
            <i class="ti ti-x" />
            <span class="hidden sm:inline">Clear</span>
          </a>
        )}
      </div>

      <div class="text-xs text-dimmed">
        {filter.search && `Results for "${filter.search}": `}
        {props.total === 0 ? "No log entries" : props.total === 1 ? "1 entry" : `${props.total} entries`}
        {hasFilters && !filter.search && " (filtered)"}
      </div>
    </div>
  );
};

export default LogFilterBar;
