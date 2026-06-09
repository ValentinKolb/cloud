import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";

type Props = {
  search: string;
  kind: string;
  status: string;
};

const KIND_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "user_delegated", label: "User-bound", icon: "ti ti-user-key" },
      { value: "resource_bound", label: "Resource-bound", icon: "ti ti-box" },
    ],
  },
];

const STATUS_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "active", label: "Active", icon: "ti ti-check" },
      { value: "revoked", label: "Revoked", icon: "ti ti-key-off" },
    ],
  },
];

const buildUrl = (params: { search?: string; kind?: string; status?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.kind?.trim()) query.set("kind", params.kind.trim());
  if (params.status?.trim() && params.status !== "active") query.set("status", params.status.trim());
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/accounts/service-accounts?${search}` : "/app/accounts/service-accounts";
};

export default function ServiceAccountsFilters(props: Props) {
  const navigate = (patch: Partial<Props>) => {
    navigateTo(buildUrl({ ...props, ...patch, page: 1 }));
  };

  return (
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip
        label="Type"
        icon="ti ti-filter"
        options={KIND_OPTIONS}
        value={props.kind ? [props.kind] : []}
        onChange={(value) => navigate({ kind: value[0] ?? "" })}
        isActive={props.kind.length > 0}
        defaultValue={[]}
      />
      <FilterChip
        label="Status"
        icon="ti ti-circle-check"
        options={STATUS_OPTIONS}
        value={props.status ? [props.status] : ["active"]}
        onChange={(value) => navigate({ status: value[0] ?? "active" })}
        isActive={(props.status || "active") !== "active"}
        defaultValue={["active"]}
      />
    </div>
  );
}
