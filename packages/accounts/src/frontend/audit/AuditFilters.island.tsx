import { EntitySearch, FilterChip, prompts, type EntitySearchPrincipal, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import type { AuditActionGroup, AuditOutcome } from "@valentinkolb/cloud/services";
import { ACTION_OPTIONS } from "./audit-labels";

type AuditFiltersProps = {
  search: string;
  actor: string;
  target: string;
  action: string;
  actionGroup: "" | AuditActionGroup;
  serviceAccountId: string;
  outcome: "" | AuditOutcome;
  provider: "" | "local" | "ipa";
  days: number;
};

const OUTCOME_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "allowed", label: "Allowed", icon: "ti ti-check" },
      { value: "denied", label: "Denied", icon: "ti ti-ban" },
      { value: "failed", label: "Failed", icon: "ti ti-alert-circle" },
    ],
  },
];

const RANGE_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "7", label: "Last 7 days", icon: "ti ti-calendar-week" },
      { value: "30", label: "Last 30 days", icon: "ti ti-calendar-month" },
      { value: "90", label: "Last 90 days", icon: "ti ti-calendar-stats" },
    ],
  },
];

const PROVIDER_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "local", label: "Local", icon: "ti ti-home-spark" },
      { value: "ipa", label: "FreeIPA", icon: "ti ti-building-fortress" },
    ],
  },
];

const ACTION_GROUP_OPTIONS: FilterChipSection[] = [
  {
    options: [{ value: "service_accounts", label: "Service accounts", icon: "ti ti-user-key" }],
  },
];

const buildAuditUrl = (params: AuditFiltersProps & { page?: number }) => {
  const query = new URLSearchParams();
  if (params.search.trim()) query.set("search", params.search.trim());
  if (params.actor.trim()) query.set("actor", params.actor.trim());
  if (params.target.trim()) query.set("target", params.target.trim());
  if (params.action.trim()) query.set("action", params.action.trim());
  if (params.actionGroup) query.set("actionGroup", params.actionGroup);
  if (params.serviceAccountId.trim()) query.set("serviceAccountId", params.serviceAccountId.trim());
  if (params.outcome) query.set("outcome", params.outcome);
  if (params.provider) query.set("provider", params.provider);
  if (params.days !== 30) query.set("days", String(params.days));
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/accounts/audit?${search}` : "/app/accounts/audit";
};

export default function AuditFilters(props: AuditFiltersProps) {
  const navigate = (patch: Partial<AuditFiltersProps>) => {
    navigateTo(
      buildAuditUrl({
        ...props,
        ...patch,
        page: 1,
      }),
    );
  };

  const selectEntity = (kind: "actor" | "target") => {
    prompts.dialog<void>(
      (close) => (
        <EntitySearch
          includeUsers
          includeGroups={kind === "target"}
          placeholder={kind === "actor" ? "Search acting user..." : "Search target user or group..."}
          onSelect={(principal: EntitySearchPrincipal) => {
            close();
            if (principal.type === "user") {
              navigate(kind === "actor" ? { actor: principal.userId } : { target: principal.userId });
            } else if (principal.type === "group" && kind === "target") {
              navigate({ target: principal.groupId });
            }
          }}
        />
      ),
      {
        title: kind === "actor" ? "Filter by actor" : "Filter by target",
        icon: kind === "actor" ? "ti ti-user-search" : "ti ti-target",
      },
    );
  };

  const selectServiceAccount = () => {
    prompts.dialog<void>(
      (close) => (
        <EntitySearch
          includeServiceAccounts
          placeholder="Search service accounts..."
          onSelect={(principal: EntitySearchPrincipal) => {
            if (principal.type !== "service_account") return;
            close();
            navigate({ actionGroup: "service_accounts", serviceAccountId: principal.serviceAccountId });
          }}
        />
      ),
      {
        title: "Filter by service account",
        icon: "ti ti-user-key",
      },
    );
  };

  return (
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip
        label="Outcome"
        icon="ti ti-filter"
        options={OUTCOME_OPTIONS}
        value={props.outcome ? [props.outcome] : []}
        onChange={(value) => navigate({ outcome: (value[0] as AuditFiltersProps["outcome"] | undefined) ?? "" })}
        isActive={props.outcome.length > 0}
        defaultValue={[]}
      />
      <FilterChip
        label="Time range"
        icon="ti ti-calendar"
        options={RANGE_OPTIONS}
        value={[String(props.days)]}
        onChange={(value) => navigate({ days: Number(value[0] ?? 30) })}
        isActive={props.days !== 30}
        defaultValue={["30"]}
      />
      <FilterChip
        label="Provider"
        icon="ti ti-building"
        options={PROVIDER_OPTIONS}
        value={props.provider ? [props.provider] : []}
        onChange={(value) => navigate({ provider: (value[0] as AuditFiltersProps["provider"] | undefined) ?? "" })}
        isActive={props.provider.length > 0}
        defaultValue={[]}
      />
      <FilterChip
        label="Action"
        icon="ti ti-bolt"
        options={ACTION_OPTIONS}
        value={props.action ? [props.action] : []}
        onChange={(value) => navigate({ action: value[0] ?? "" })}
        isActive={props.action.length > 0}
        defaultValue={[]}
      />
      <FilterChip
        label="Area"
        icon="ti ti-category"
        options={ACTION_GROUP_OPTIONS}
        value={props.actionGroup ? [props.actionGroup] : []}
        onChange={(value) => navigate({ actionGroup: (value[0] as AuditFiltersProps["actionGroup"] | undefined) ?? "" })}
        isActive={props.actionGroup.length > 0}
        defaultValue={[]}
      />
      <button type="button" class={`btn-input btn-input-sm ${props.actor ? "btn-input-active" : ""}`} onClick={() => selectEntity("actor")}>
        <i class="ti ti-user-search" />
        <span>Actor</span>
      </button>
      <button
        type="button"
        class={`btn-input btn-input-sm ${props.target ? "btn-input-active" : ""}`}
        onClick={() => selectEntity("target")}
      >
        <i class="ti ti-target" />
        <span>Target</span>
      </button>
      <button
        type="button"
        class={`btn-input btn-input-sm ${props.serviceAccountId ? "btn-input-active" : ""}`}
        onClick={selectServiceAccount}
      >
        <i class="ti ti-user-key" />
        <span>Service account</span>
      </button>
    </div>
  );
}
