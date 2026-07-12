import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { buildLegacyNotificationsUrl, type LegacyNotificationStatusFilter, NOTIFICATION_ADMIN_BASE_URL } from "./filter-state";
import SendAllPending from "./SendAllPending.island";

export type NotificationStatusFilter = LegacyNotificationStatusFilter;

type Props = {
  search: string;
  status: NotificationStatusFilter;
};

const STATUS_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All", icon: "ti ti-list" },
      { value: "pending", label: "Pending", icon: "ti ti-clock", color: "#d97706" },
      { value: "sent", label: "Sent", icon: "ti ti-check", color: "#059669" },
      { value: "error", label: "Error", icon: "ti ti-alert-circle", color: "#ef4444" },
    ],
  },
];

const buildNotificationsUrl = (filter: { search?: string; status?: NotificationStatusFilter }) => {
  return buildLegacyNotificationsUrl({ search: filter.search ?? "", status: filter.status ?? "all" });
};

export default function NotificationFilterBar(props: Props) {
  const searchAction = buildNotificationsUrl({ status: props.status });

  const setStatus = (value: string[]) => {
    const status = (value[0] ?? "all") as NotificationStatusFilter;
    navigateTo(buildNotificationsUrl({ search: props.search, status }));
  };

  const hasFilters = props.search.length > 0 || props.status !== "all";

  return (
    <div class="flex flex-col gap-2">
      <SearchBar action={searchAction} value={props.search} placeholder="Search notifications..." ariaLabel="Search notifications" />
      <div class="flex items-center gap-2 flex-wrap">
        <FilterChip
          label="Status"
          icon="ti ti-filter"
          options={STATUS_OPTIONS}
          value={[props.status]}
          onChange={setStatus}
          isActive={props.status !== "all"}
          defaultValue={["all"]}
        />
        {hasFilters && (
          <a
            href={`${NOTIFICATION_ADMIN_BASE_URL}?view=legacy`}
            class="hidden text-[10px] tabular-nums text-red-500 sm:inline"
            aria-label="Clear all filters"
            title="Clear filters"
          >
            <i class="ti ti-x" /> Clear
          </a>
        )}
        <div class="ml-auto">
          <SendAllPending />
        </div>
      </div>
    </div>
  );
}
