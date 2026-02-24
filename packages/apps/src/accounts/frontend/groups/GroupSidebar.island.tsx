import { For, Show } from "solid-js";
import type { BaseGroup } from "@/accounts/contracts";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import NewGroup from "./NewGroup.island";
import {
  GROUPS_CONTEXT_QUERY_KEYS,
  GROUPS_QUERY_KEYS,
  buildGroupDetailUrl,
  buildGroupsPageBaseUrl,
  buildGroupsUrl,
  type GroupQueryKeys,
  type GroupsListState,
} from "../lib/url-state";
type Props = {
  groups: BaseGroup[];
  total: number;
  perPage: number;
  activeCn: string | null;
  isAdmin: boolean;
  managedCns: string[];
  listState: GroupsListState;
  basePath?: string;
  detailQueryKeys?: GroupQueryKeys;
  defaultShowAll?: boolean;
};
export default function GroupSidebar(props: Props) {
  const managedSet = new Set(props.managedCns);
  const basePath = props.basePath ?? "/app/accounts/groups";
  const defaultShowAll = props.defaultShowAll ?? false;
  const detailQueryKeys = props.detailQueryKeys ?? GROUPS_CONTEXT_QUERY_KEYS;
  const totalPages = Math.max(1, Math.ceil(props.total / props.perPage));
  const paginationBaseUrl = buildGroupsPageBaseUrl(
    { search: props.listState.search, showAll: props.listState.showAll },
    { basePath, keys: GROUPS_QUERY_KEYS, defaultShowAll },
  );
  return (
    <nav class="flex flex-col h-full">
      <div class="p-2">
        <SearchBar action={basePath} value={props.listState.search} />
      </div>
      <div class="px-3 pb-1 text-[10px] text-dimmed flex items-center gap-1">
        <span>
          {props.listState.search
            ? `${props.total} result${props.total !== 1 ? "s" : ""}`
            : `${props.total} group${props.total !== 1 ? "s" : ""}`}
        </span>
        <span>·</span>
        <a
          href={buildGroupsUrl(
            { ...props.listState, page: 1, showAll: !props.listState.showAll },
            { basePath, keys: GROUPS_QUERY_KEYS, defaultShowAll },
          )}
          class="underline decoration-dotted hover:text-primary transition-colors"
          title={props.listState.showAll ? "Show my groups" : "Show all groups"}
        >
          {props.listState.showAll ? "all" : "mine"}
        </a>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <For each={props.groups}>
          {(group) => {
            const isActive = group.cn === props.activeCn;
            const isManaged = managedSet.has(group.cn);
            return (
              <a
                href={buildGroupDetailUrl(group.cn, props.listState, { keys: detailQueryKeys, defaultShowAll })}
                class={`list-item text-xs ${isActive ? "list-item-active" : ""}`}
              >
                <i class={`ti text-sm ${isManaged ? "ti-user-edit text-blue-500" : "ti-users-group"}`} />
                <span class="flex-1 min-w-0 truncate">{group.cn}</span>
                <Show when={group.gidnumber}>
                  <span class="text-[9px] px-1 py-px rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <i class="ti ti-folder" />
                  </span>
                </Show>
              </a>
            );
          }}
        </For>
        <Show when={props.groups.length === 0}>
          <div class="px-3 py-4 text-xs text-dimmed text-center">No groups found.</div>
        </Show>
      </div>
      <div class="px-2 pb-2">
        <Pagination currentPage={props.listState.page} totalPages={totalPages} baseUrl={paginationBaseUrl} />
      </div>
      <Show when={props.isAdmin}>
        <div class="p-2 [&>button]:w-full [&>button]:btn-sm">
          <NewGroup />
        </div>
      </Show>
    </nav>
  );
}
