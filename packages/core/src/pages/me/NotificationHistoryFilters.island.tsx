import type { NotificationDeliveryStatus } from "@valentinkolb/cloud/contracts";
import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";

const STATUS_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "all", label: "All", icon: "ti ti-list" },
      { value: "delivered", label: "Delivered", icon: "ti ti-check" },
      { value: "pending", label: "Pending", icon: "ti ti-clock" },
      { value: "failed", label: "Failed", icon: "ti ti-alert-triangle" },
      { value: "suppressed", label: "Not sent", icon: "ti ti-bell-off" },
    ],
  },
];

export default function NotificationHistoryFilters(props: { status?: NotificationDeliveryStatus }) {
  const setStatus = (value: string) => {
    const params = new URLSearchParams(window.location.search);
    params.delete("page");
    if (value === "all") params.delete("status");
    else params.set("status", value);
    const query = params.toString();
    navigateTo(query ? `/me/notifications?${query}` : "/me/notifications");
  };

  return (
    <FilterChip
      label="Status"
      icon="ti ti-filter"
      options={STATUS_OPTIONS}
      value={[props.status ?? "all"]}
      onChange={(value) => setStatus(value[0] ?? "all")}
      isActive={props.status !== undefined}
      defaultValue={["all"]}
      position="bottom-right"
      iconOnly
    />
  );
}
