import { buildGroupDetailUrl, GROUPS_CONTEXT_QUERY_KEYS, type GroupQueryKeys, type GroupsListState } from "../../lib/url-state";

const GROUP_DETAIL_TABS = ["members", "managers", "member-of"] as const;

type GroupDetailTab = (typeof GROUP_DETAIL_TABS)[number];

export const GROUP_DETAIL_TAB_META: Record<GroupDetailTab, { label: string; icon: string }> = {
  members: { label: "Members", icon: "ti ti-users-group" },
  managers: { label: "Managers", icon: "ti ti-user-cog" },
  "member-of": { label: "Member Of", icon: "ti ti-folders" },
};

type DetailHrefOptions = {
  listState: GroupsListState;
  defaultScope: GroupsListState["scope"];
  keys?: GroupQueryKeys;
};

type DetailQueryOverrides = Record<string, string | null | undefined>;

export const getGroupsBackLabel = (scope: GroupsListState["scope"]): string =>
  scope === "managed" ? "Managed Groups" : scope === "member" ? "My Groups" : "All Groups";

export const getVisibleGroupDetailTabs = (isAdmin: boolean): GroupDetailTab[] =>
  GROUP_DETAIL_TABS.filter((tab) => tab !== "member-of" || isAdmin);

export const parseGroupDetailTab = (requested: string | undefined, isAdmin: boolean): GroupDetailTab => {
  const tab = GROUP_DETAIL_TABS.includes(requested as GroupDetailTab) ? (requested as GroupDetailTab) : "members";
  return tab === "member-of" && !isAdmin ? "members" : tab;
};

export const createGroupDetailHrefBuilder =
  ({ listState, defaultScope, keys = GROUPS_CONTEXT_QUERY_KEYS }: DetailHrefOptions) =>
  (targetGroupId: string, overrides: DetailQueryOverrides = {}): string => {
    const base = buildGroupDetailUrl(targetGroupId, listState, {
      keys,
      defaultScope,
    });
    const url = new URL(base, "https://local.invalid");

    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === undefined || value.length === 0) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    }

    return `${url.pathname}${url.search}`;
  };

const buildPageBaseUrl = (href: string): string => `${href}${href.includes("?") ? "&" : "?"}page=`;

export const buildGroupDetailPageBaseUrl = (
  buildDetailHref: ReturnType<typeof createGroupDetailHrefBuilder>,
  groupId: string,
  overrides: DetailQueryOverrides,
): string => buildPageBaseUrl(buildDetailHref(groupId, { ...overrides, page: null }));
