import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/cloud/ui";

type ReminderFiltersProps = {
  search: string;
  status: string;
  kind: string;
};

const STATUS_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "", label: "All", icon: "ti ti-list" },
      { value: "pending", label: "Pending", icon: "ti ti-clock" },
      { value: "sent", label: "Sent", icon: "ti ti-check" },
      { value: "error", label: "Error", icon: "ti ti-alert-circle" },
    ],
  },
];

const KIND_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "", label: "All", icon: "ti ti-list" },
      { value: "ipa_expiry", label: "IPA", icon: "ti ti-user-shield" },
      { value: "guest_expiry", label: "Guest", icon: "ti ti-user" },
    ],
  },
];

const buildUrl = (params: { search?: string; kind?: string; status?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.kind?.trim()) query.set("kind", params.kind.trim());
  if (params.status?.trim()) query.set("status", params.status.trim());
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/accounts/reminders?${search}` : "/app/accounts/reminders";
};

export default function ReminderFilters(props: ReminderFiltersProps) {
  const navigate = (patch: { kind?: string; status?: string }) => {
    navigateTo(buildUrl({
      search: props.search,
      kind: patch.kind ?? props.kind,
      status: patch.status ?? props.status,
      page: 1,
    }));
  };

  return (
    <div class="flex flex-wrap gap-2">
      <FilterChip
        label="Status"
        icon="ti ti-filter"
        options={STATUS_OPTIONS}
        value={props.status ? [props.status] : []}
        onChange={(value) => navigate({ status: value[0] ?? "" })}
        isActive={props.status.length > 0}
        defaultValue={[]}
      />
      <FilterChip
        label="Kind"
        icon="ti ti-bell"
        options={KIND_OPTIONS}
        value={props.kind ? [props.kind] : []}
        onChange={(value) => navigate({ kind: value[0] ?? "" })}
        isActive={props.kind.length > 0}
        defaultValue={[]}
      />
    </div>
  );
}
