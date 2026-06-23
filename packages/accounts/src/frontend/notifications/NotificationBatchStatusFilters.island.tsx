import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";

type Props = {
  status: string;
};

const STATUS_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "draft", label: "Draft", icon: "ti ti-edit" },
      { value: "ready", label: "Ready", icon: "ti ti-player-play" },
      { value: "running", label: "Running", icon: "ti ti-loader-2" },
      { value: "completed", label: "Completed", icon: "ti ti-check" },
      { value: "completed_with_errors", label: "With errors", icon: "ti ti-alert-triangle" },
      { value: "failed", label: "Failed", icon: "ti ti-circle-x" },
    ],
  },
];

const buildUrl = (status: string) => {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  const search = query.toString();
  return search ? `/app/accounts/notifications?${search}` : "/app/accounts/notifications";
};

export default function NotificationBatchStatusFilters(props: Props) {
  return (
    <FilterChip
      label="Status"
      icon="ti ti-circle-check"
      options={STATUS_OPTIONS}
      value={props.status ? [props.status] : []}
      onChange={(value) => navigateTo(buildUrl(value[0] ?? ""))}
      isActive={props.status.length > 0}
      defaultValue={[]}
    />
  );
}
