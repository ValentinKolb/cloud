import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/lib/ui";
import { buildGroupsUrl, type GroupsListState } from "../lib/url-state";

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

export default function GroupsScopeFilter(props: GroupsScopeFilterProps) {
  return (
    <FilterChip
      label="View"
      icon="ti ti-adjustments-horizontal"
      options={SCOPE_OPTIONS}
      value={[props.state.scope, props.state.provider]}
      onChange={(value) =>
        (window.location.href = buildGroupsUrl(
          {
            ...props.state,
            scope: (value[0] as GroupsListState["scope"] | undefined) ?? props.defaultScope,
            provider: (value[1] as GroupsListState["provider"] | undefined) ?? "",
            page: 1,
          },
          { defaultScope: props.defaultScope },
        ))
      }
      defaultValue={[props.defaultScope, ""]}
    />
  );
}
