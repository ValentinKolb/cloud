import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import {
  buildDeliveryNotificationsUrl,
  type DeliveryStatusFilter,
  NOTIFICATION_ADMIN_BASE_URL,
  type NotificationAppFilterOption,
  notificationChannelIcon,
  notificationChannelLabel,
} from "./filter-state";

type Props = {
  search: string;
  status: DeliveryStatusFilter;
  channels: string[];
  appIds: string[];
  channelOptions: string[];
  appOptions: NotificationAppFilterOption[];
};

const STATUS_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All", icon: "ti ti-list" },
      { value: "pending", label: "Pending", icon: "ti ti-clock", color: "#d97706" },
      { value: "sending", label: "Sending", icon: "ti ti-send", color: "#2563eb" },
      { value: "delivered", label: "Delivered", icon: "ti ti-check", color: "#059669" },
      { value: "suppressed", label: "Suppressed", icon: "ti ti-bell-off", color: "#71717a" },
      { value: "failed", label: "Failed", icon: "ti ti-alert-circle", color: "#ef4444" },
      { value: "deferred", label: "Deferred", icon: "ti ti-player-pause", color: "#71717a" },
    ],
  },
];

export default function DeliveryFilterBar(props: Props) {
  const navigate = (patch: Partial<Pick<Props, "status" | "channels" | "appIds">>) =>
    navigateTo(
      buildDeliveryNotificationsUrl({
        search: props.search,
        status: patch.status ?? props.status,
        channels: patch.channels ?? props.channels,
        appIds: patch.appIds ?? props.appIds,
      }),
    );
  const channelSections = (): FilterChipSection[] => [
    {
      multiple: true,
      options: props.channelOptions.map((channel) => ({
        value: channel,
        label: notificationChannelLabel(channel),
        icon: notificationChannelIcon(channel),
      })),
    },
  ];
  const appSections = (): FilterChipSection[] => [
    {
      multiple: true,
      options: props.appOptions.map((app) => ({ value: app.id, label: app.label, icon: app.icon })),
    },
  ];
  const searchAction = buildDeliveryNotificationsUrl({ search: "", status: props.status, channels: props.channels, appIds: props.appIds });
  const hasFilters = props.search.length > 0 || props.status !== "all" || props.channels.length > 0 || props.appIds.length > 0;

  return (
    <div class="flex flex-col gap-2">
      <SearchBar action={searchAction} value={props.search} placeholder="Search deliveries..." ariaLabel="Search notification deliveries" />
      <div class="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Status"
          icon="ti ti-filter"
          options={STATUS_OPTIONS}
          value={[props.status]}
          onChange={(value) => navigate({ status: (value[0] ?? "all") as DeliveryStatusFilter })}
          isActive={props.status !== "all"}
          defaultValue={["all"]}
        />
        {props.channelOptions.length > 0 && (
          <FilterChip
            label="Channel"
            icon="ti ti-route"
            options={channelSections()}
            value={props.channels}
            onChange={(channels) => navigate({ channels })}
            isActive={props.channels.length > 0}
            defaultValue={[]}
          />
        )}
        {props.appOptions.length > 0 && (
          <FilterChip
            label="App"
            icon="ti ti-apps"
            options={appSections()}
            value={props.appIds}
            onChange={(appIds) => navigate({ appIds })}
            isActive={props.appIds.length > 0}
            defaultValue={[]}
          />
        )}
        {hasFilters && (
          <a
            href={NOTIFICATION_ADMIN_BASE_URL}
            class="hidden text-[10px] tabular-nums text-red-500 sm:inline"
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
