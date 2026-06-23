import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";

type Props = {
  batchId: string;
  status: string;
};

const STATUS_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "pending", label: "Pending", icon: "ti ti-clock" },
      { value: "sending", label: "Sending", icon: "ti ti-loader-2" },
      { value: "sent", label: "Sent", icon: "ti ti-check" },
      { value: "skipped", label: "Skipped", icon: "ti ti-ban" },
      { value: "error", label: "Error", icon: "ti ti-alert-triangle" },
    ],
  },
];

const buildUrl = (batchId: string, status: string) => {
  const query = new URLSearchParams();
  if (status) query.set("recipient_status", status);
  const search = query.toString();
  return search ? `/app/accounts/notifications/${batchId}?${search}` : `/app/accounts/notifications/${batchId}`;
};

export default function NotificationRecipientStatusFilters(props: Props) {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip
        label="Recipient status"
        icon="ti ti-circle-check"
        options={STATUS_OPTIONS}
        value={props.status ? [props.status] : []}
        onChange={(value) => navigateTo(buildUrl(props.batchId, value[0] ?? ""))}
        isActive={props.status.length > 0}
        defaultValue={[]}
      />
    </div>
  );
}
