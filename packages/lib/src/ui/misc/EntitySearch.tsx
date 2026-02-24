import { createSignal, For, Show } from "solid-js";
import { createDebounce } from "@/browser/timed";
import { apiClient } from "@/browser/client-utils";
import TextInput from "@/ui/input/TextInput";

type UserResult = {
  id: string;
  uid: string;
  displayName: string;
  mail: string | null;
};

type GroupResult = {
  cn: string;
  description: string | null;
};

export type EntitySearchResult =
  | { type: "user"; id: string; displayName: string; mail: string | null }
  | { type: "group"; id: string; description: string | null };

type EntitySearchProps = {
  groupCn?: string;
  searchUsers?: boolean;
  searchGroups?: boolean;
  excludeUserIds?: string[];
  excludeGroups?: string[];
  onSelect: (result: EntitySearchResult) => void;
  placeholder?: string;
  adding?: boolean;
  onlyUserGroups?: boolean;
  onlyPosixGroups?: boolean;
  usersInGroups?: string[];
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
      const res = await apiClient.ipa.groups[":cn"].search.$get({
        param: { cn: props.groupCn ?? "_" },
        query: {
          q,
          users: props.searchUsers !== false ? "true" : "false",
          groups: props.searchGroups ? "true" : "false",
          exclude_user_ids: props.excludeUserIds?.join(","),
          exclude_groups: props.excludeGroups?.join(","),
          only_user_groups: props.onlyUserGroups ? "true" : "false",
          only_posix_groups: props.onlyPosixGroups ? "true" : "false",
          users_in_groups: props.usersInGroups?.join(","),
        },
      });

      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
        setGroups(data.groups ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  const { debouncedFn: debouncedSearch } = createDebounce(doSearch, 300);

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
                    <div class="truncate text-sm font-medium">{group.cn}</div>
                    <Show when={group.description}>
                      <div class="truncate text-xs text-dimmed">{group.description}</div>
                    </Show>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleSelect({
                        type: "group",
                        id: group.cn,
                        description: group.description,
                      })
                    }
                    disabled={addingId() !== null || props.adding}
                    class="rounded p-2 text-emerald-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-900/20"
                    aria-label={`Add ${group.cn}`}
                  >
                    <i class={addingId() === group.cn ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
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
