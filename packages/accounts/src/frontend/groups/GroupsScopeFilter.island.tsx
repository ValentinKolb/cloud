import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { buildGroupsUrl, type GroupsListState } from "../lib/url-state";
import { navigateTo } from "@valentinkolb/cloud/ui";

type GroupsScopeFilterProps = {
  state: GroupsListState;
  defaultScope: GroupsListState["scope"];
};

const SCOPE_OPTIONS: FilterChipSection[] = [
  {
    label: "Membership",
    options: [
      { value: "managed", label: "Managed by me", icon: "ti ti-shield-check" },
      { value: "member", label: "My groups", icon: "ti ti-users-group" },
      { value: "all", label: "All groups", icon: "ti ti-layout-grid" },
    ],
  },
  {
    label: "Origin",
    options: [
      { value: "", label: "All origins", icon: "ti ti-stack-2" },
      { value: "ipa", label: "FreeIPA", icon: "ti ti-building-fortress" },
      { value: "local", label: "Local", icon: "ti ti-home" },
    ],
  },
];

const SCOPE_VALUES = new Set<GroupsListState["scope"]>(["managed", "member", "all"]);
const PROVIDER_VALUES = new Set<Exclude<GroupsListState["provider"], never>>(["", "ipa", "local"]);

export default function GroupsScopeFilter(props: GroupsScopeFilterProps) {
  return (
    <FilterChip
      label="View"
      icon="ti ti-adjustments-horizontal"
      options={SCOPE_OPTIONS}
      value={[props.state.scope, props.state.provider]}
      onChange={(value) => {
        const nextScope = value.find((entry): entry is GroupsListState["scope"] => SCOPE_VALUES.has(entry as GroupsListState["scope"])) ?? props.defaultScope;
        const nextProvider = value.find((entry): entry is GroupsListState["provider"] => PROVIDER_VALUES.has(entry as GroupsListState["provider"])) ?? "";

        navigateTo(buildGroupsUrl(
          {
            ...props.state,
            scope: nextScope,
            provider: nextProvider,
            page: 1,
          },
          { defaultScope: props.defaultScope },
        ));
      }}
      defaultValue={[props.defaultScope, ""]}
    />
  );
}
