import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/lib/ui";
import { buildUsersUrl, type UsersListState } from "../lib/url-state";

type UsersFiltersProps = {
  state: UsersListState;
};

const PROVIDER_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "ipa", label: "FreeIPA", icon: "ti ti-building-fortress" },
      { value: "local", label: "Local", icon: "ti ti-home-spark" },
    ],
  },
];

const PROFILE_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "user", label: "Full account", icon: "ti ti-user-check" },
      { value: "guest", label: "Guest account", icon: "ti ti-user-exclamation" },
    ],
  },
];

export default function UsersFilters(props: UsersFiltersProps) {
  const navigate = (patch: Partial<UsersListState>) => {
    window.location.href = buildUsersUrl({
      ...props.state,
      ...patch,
      page: 1,
    });
  };

  return (
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip
        label="Managed by"
        icon="ti ti-building-bank"
        options={PROVIDER_OPTIONS}
        value={props.state.provider ? [props.state.provider] : []}
        onChange={(value) => navigate({ provider: (value[0] as UsersListState["provider"] | undefined) ?? "" })}
        isActive={props.state.provider.length > 0}
        defaultValue={[]}
      />
      <FilterChip
        label="Access level"
        icon="ti ti-badge"
        options={PROFILE_OPTIONS}
        value={props.state.profile ? [props.state.profile] : []}
        onChange={(value) => navigate({ profile: (value[0] as UsersListState["profile"] | undefined) ?? "" })}
        isActive={props.state.profile.length > 0}
        defaultValue={[]}
      />
    </div>
  );
}
