import { navigateTo } from "@k2b/ssr/nav";
import { SegmentedControl } from "@k2b/ui";
import { buildNotificationViewUrl, type NotificationAdminView } from "./filter-state";

const options = [
  { value: "deliveries", label: "Deliveries", icon: "ti ti-route" },
  { value: "registry", label: "Registry", icon: "ti ti-list-details" },
  { value: "legacy", label: "Legacy", icon: "ti ti-mail" },
] satisfies Array<{ value: NotificationAdminView; label: string; icon: string }>;

export default function NotificationViewSwitch(props: { view: NotificationAdminView }) {
  return (
    <SegmentedControl
      options={options}
      value={() => props.view}
      onValueChange={(view) => navigateTo(buildNotificationViewUrl(view))}
      ariaLabel="Notification observability view"
    />
  );
}
