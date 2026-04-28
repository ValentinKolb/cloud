import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/cloud/ui";

type DeletedAccountsFiltersProps = {
  search: string;
  reason: string;
};

const REASON_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "", label: "All", icon: "ti ti-list" },
      { value: "ipa_expired_demoted", label: "IPA expired", icon: "ti ti-user-down" },
      { value: "ipa_expired_deleted", label: "IPA expired delete", icon: "ti ti-user-x" },
      { value: "sync_out_of_scope_demoted", label: "Sync out of scope", icon: "ti ti-user-off" },
      { value: "sync_out_of_scope_deleted", label: "Sync delete", icon: "ti ti-user-minus" },
      { value: "guest_expired_deleted", label: "Guest expired", icon: "ti ti-user-x" },
      { value: "local_user_expired_deleted", label: "Local user expired", icon: "ti ti-user-minus" },
      { value: "manual_demote", label: "Manual demote", icon: "ti ti-user-down" },
      { value: "manual_delete", label: "Manual delete", icon: "ti ti-trash" },
    ],
  },
];

const buildUrl = (params: { search?: string; reason?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.reason?.trim()) query.set("reason", params.reason.trim());
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/accounts/deleted-accounts?${search}` : "/app/accounts/deleted-accounts";
};

export default function DeletedAccountsFilters(props: DeletedAccountsFiltersProps) {
  const navigate = (reason: string) => {
    navigateTo(buildUrl({ search: props.search, reason, page: 1 }));
  };

  return (
    <FilterChip
      label="Reason"
      icon="ti ti-filter"
      options={REASON_OPTIONS}
      value={props.reason ? [props.reason] : []}
      onChange={(value) => navigate(value[0] ?? "")}
      isActive={props.reason.length > 0}
      defaultValue={[]}
    />
  );
}
