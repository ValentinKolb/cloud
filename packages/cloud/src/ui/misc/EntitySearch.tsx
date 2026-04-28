import { createSignal, For, Show } from "solid-js";
import { timed } from "@valentinkolb/stdlib/solid";
import TextInput from "../input/TextInput";

type UserResult = {
  id: string;
  uid: string;
  displayName: string;
  mail: string | null;
};

type GroupResult = {
  id: string;
  provider: "ipa" | "local";
  name: string;
  description: string | null;
};

export type EntitySearchResult =
  | { type: "user"; id: string; displayName: string; mail: string | null }
  | { type: "group"; id: string; provider: "ipa" | "local"; name: string; description: string | null };

type EntitySearchProps = {
  apiBaseUrl?: string;
  groupProvider?: "ipa" | "local";
  searchUsers?: boolean;
  searchGroups?: boolean;
  excludeUserIds?: string[];
  excludeGroupIds?: string[];
  onSelect: (result: EntitySearchResult) => void;
  placeholder?: string;
  adding?: boolean;
  userMemberOfGroupIds?: string[];
  resultsHeightClass?: string;
};

const EntitySearch = (props: EntitySearchProps) => {
  const [search, setSearch] = createSignal("");
  const [users, setUsers] = createSignal<UserResult[]>([]);
  const [groups, setGroups] = createSignal<GroupResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [addingId, setAddingId] = createSignal<string | null>(null);

  const doSearch = async (q: string) => {
    if (q.length < 2) {
      setUsers([]);
      setGroups([]);
      return;
    }

    setLoading(true);
    try {
      const url = new URL(`${props.apiBaseUrl ?? "/api/accounts"}/entities`, window.location.origin);
      const kinds = [
        ...(props.searchUsers !== false ? ["user"] : []),
        ...(props.searchGroups ? ["group"] : []),
      ];
      if (kinds.length === 0) {
        setUsers([]);
        setGroups([]);
        return;
      }

      url.searchParams.set("search", q);
      url.searchParams.set("kinds", kinds.join(","));
      url.searchParams.set("per_page", "10");

      if (props.excludeUserIds && props.excludeUserIds.length > 0) {
        url.searchParams.set("exclude_user_ids", props.excludeUserIds.join(","));
      }

      if (props.excludeGroupIds && props.excludeGroupIds.length > 0) {
        url.searchParams.set("exclude_group_ids", props.excludeGroupIds.join(","));
      }

      if (props.userMemberOfGroupIds && props.userMemberOfGroupIds.length > 0) {
        url.searchParams.set("user_member_of_group_ids", props.userMemberOfGroupIds.join(","));
      }

      if (props.groupProvider) {
        url.searchParams.set("provider", props.groupProvider);
      }

      const res = await fetch(url.toString(), {
        credentials: "same-origin",
      });

      if (res.ok) {
        const data = await res.json();
        const items = data.items ?? [];
        setUsers(items.filter((item: { kind: string }) => item.kind === "user").map((item: { user: UserResult }) => item.user));
        setGroups(items.filter((item: { kind: string }) => item.kind === "group").map((item: { group: GroupResult }) => item.group));
      }
    } finally {
      setLoading(false);
    }
  };

  const { debouncedFn: debouncedSearch } = timed.debounce(doSearch, 300);

  const handleInput = (value: string) => {
    setSearch(value);
    debouncedSearch(value);
  };

  const handleSelect = (result: EntitySearchResult) => {
    setAddingId(result.id);
    props.onSelect(result);
    setAddingId(null);
  };

  const resultsHeightClass = () => props.resultsHeightClass ?? "h-48";

  return (
    <div class="flex flex-col gap-3">
      <TextInput icon="ti ti-search" placeholder={props.placeholder ?? "Search..."} value={() => search()} onInput={handleInput} />

      <div class={`${resultsHeightClass()} overflow-y-auto`}>
        <Show when={loading()}>
          <div class="flex items-center justify-center py-8 text-dimmed">
            <i class="ti ti-loader-2 animate-spin text-xl" />
          </div>
        </Show>

        <Show when={!loading() && search().length >= 2 && users().length === 0 && groups().length === 0}>
          <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
            <i class="ti ti-search-off text-sm" />
            No results found
          </p>
        </Show>

        <Show when={!loading() && search().length < 2}>
          <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
            <i class="ti ti-search text-sm" />
            Type at least 2 characters
          </p>
        </Show>

        <Show when={!loading() && (users().length > 0 || groups().length > 0)}>
          <div class="flex flex-col gap-1">
            <For each={users()}>
              {(user) => (
                <div class="flex items-center gap-3 rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    <i class="ti ti-user text-sm" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{user.displayName}</div>
                    <div class="truncate text-xs text-dimmed">
                      {user.uid}
                      {user.mail && ` · ${user.mail}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleSelect({
                        type: "user",
                        id: user.id,
                        displayName: user.displayName,
                        mail: user.mail,
                      })
                    }
                    disabled={addingId() !== null || props.adding}
                    class="rounded p-2 text-emerald-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-900/20"
                    aria-label={`Add ${user.displayName}`}
                  >
                    <i class={addingId() === user.id ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
                  </button>
                </div>
              )}
            </For>

            <For each={groups()}>
              {(group) => (
                <div class="flex items-center gap-3 rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    <i class="ti ti-users-group text-sm" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{group.name}</div>
                    <Show when={group.description}>
                      <div class="truncate text-xs text-dimmed">{group.description}</div>
                    </Show>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleSelect({
                        type: "group",
                        id: group.id,
                        provider: group.provider,
                        name: group.name,
                        description: group.description,
                      })
                    }
                    disabled={addingId() !== null || props.adding}
                    class="rounded p-2 text-emerald-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-900/20"
                    aria-label={`Add ${group.name}`}
                  >
                    <i class={addingId() === group.id ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default EntitySearch;
