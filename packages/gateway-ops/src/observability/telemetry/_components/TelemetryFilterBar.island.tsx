import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@k2b/ssr/nav";
import {
  DEFAULT_TELEMETRY_ROUTE_SORT,
  TELEMETRY_RANGES,
  TELEMETRY_ROUTE_SORTS,
  TELEMETRY_SORT_LABELS,
  type TelemetryRange,
  type TelemetryRouteSort,
} from "../contracts";
import { buildTelemetryFilterUrl, clearTelemetryFiltersUrl, hasActiveTelemetryFilters, selectAppUrl, type TelemetryFilter } from "./types";

export type TelemetryAppFilterOption = {
  id: string;
  label: string;
  icon: string;
};

type Props = {
  filter: TelemetryFilter;
  apps: TelemetryAppFilterOption[];
};

const RANGE_LABELS: Record<TelemetryRange, string> = {
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const SORT_ICONS: Record<TelemetryRouteSort, string> = {
  errorRate: "ti ti-percentage",
  errors: "ti ti-alert-circle",
  requests: "ti ti-flame",
  slow: "ti ti-clock-exclamation",
  duration: "ti ti-hourglass",
};

const rangeOptions: FilterChipSection[] = [
  {
    options: (Object.keys(TELEMETRY_RANGES) as TelemetryRange[]).map((value) => ({
      value,
      label: RANGE_LABELS[value],
      icon: "ti ti-clock",
    })),
  },
];

const sortOptions: FilterChipSection[] = [
  {
    options: TELEMETRY_ROUTE_SORTS.map((value) => ({
      value,
      label: TELEMETRY_SORT_LABELS[value],
      icon: SORT_ICONS[value],
    })),
  },
];

const scopeOptions: FilterChipSection[] = [
  {
    options: [
      { value: "errors", label: "With errors", icon: "ti ti-alert-circle" },
      { value: "slow", label: "With slow requests", icon: "ti ti-clock-exclamation" },
    ],
    multiple: true,
  },
];

/**
 * Navigation only — the server owns every value shown here. This is an island
 * purely because `FilterChip` needs click handlers.
 */
export default function TelemetryFilterBar(props: Props) {
  const appOptions = (): FilterChipSection[] => [
    {
      options: [
        { value: "", label: "All apps", icon: "ti ti-apps" },
        ...props.apps.map((app) => ({ value: app.id, label: app.label, icon: app.icon })),
      ],
    },
  ];

  const activeScope = () => [props.filter.errorsOnly ? "errors" : "", props.filter.slowOnly ? "slow" : ""].filter(Boolean);

  return (
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip
        label={RANGE_LABELS[props.filter.range]}
        icon="ti ti-clock"
        options={rangeOptions}
        value={[props.filter.range]}
        onChange={(value) => {
          const range = value[0] as TelemetryRange | undefined;
          if (range) navigateTo(buildTelemetryFilterUrl(props.filter, { range }));
        }}
        isActive
        defaultValue={[props.filter.range]}
      />
      <FilterChip
        label="App"
        icon="ti ti-apps"
        options={appOptions()}
        value={props.filter.appId ? [props.filter.appId] : []}
        onChange={(value) => navigateTo(selectAppUrl(props.filter, value[0] ?? ""))}
        isActive={props.filter.appId.length > 0}
        defaultValue={[]}
      />
      <FilterChip
        label={`Sort: ${TELEMETRY_SORT_LABELS[props.filter.sort]}`}
        icon="ti ti-arrows-sort"
        options={sortOptions}
        value={[props.filter.sort]}
        onChange={(value) => {
          const sort = (value[0] ?? DEFAULT_TELEMETRY_ROUTE_SORT) as TelemetryRouteSort;
          navigateTo(buildTelemetryFilterUrl(props.filter, { sort }));
        }}
        isActive={props.filter.sort !== DEFAULT_TELEMETRY_ROUTE_SORT}
        defaultValue={[DEFAULT_TELEMETRY_ROUTE_SORT]}
      />
      <FilterChip
        label="Show only"
        icon="ti ti-filter"
        options={scopeOptions}
        value={activeScope()}
        onChange={(value) =>
          navigateTo(
            buildTelemetryFilterUrl(props.filter, {
              errorsOnly: value.includes("errors"),
              slowOnly: value.includes("slow"),
            }),
          )
        }
        isActive={props.filter.errorsOnly || props.filter.slowOnly}
        defaultValue={[]}
      />
      {hasActiveTelemetryFilters(props.filter) ? (
        <a href={clearTelemetryFiltersUrl(props.filter)} class="btn-input btn-input-sm">
          <i class="ti ti-x" aria-hidden="true" /> Clear
        </a>
      ) : null}
    </div>
  );
}
