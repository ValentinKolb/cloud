import { createSignal, Show, For } from "solid-js";
import { Dropdown, TextInput } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { timing } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/hosts/client";
import { refreshCurrentPath } from "./lib/navigation";
type HostActionsProps = {
  fqdn: string;
  description: string | null;
  locality: string | null;
  location: string | null;
  memberofHostgroup: string[];
  currentGroup?: string;
};
const HostActions = (props: HostActionsProps) => {
  const editMutation = mutations.create<void, { description?: string; locality?: string; location?: string }>({
    mutation: async (vars) => {
      const res = await apiClient[":fqdn"].$patch({ param: { fqdn: props.fqdn }, json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update host.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });
  const deleteMutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient[":fqdn"].$delete({ param: { fqdn: props.fqdn } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to delete host.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });
  const addToGroupMutation = mutations.create<void, string>({
    mutation: async (hostgroup) => {
      const res = await apiClient[":fqdn"].hostgroups.$post({ param: { fqdn: props.fqdn }, json: { hostgroup } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to add host to group.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });
  const removeFromGroupMutation = mutations.create<void, string>({
    mutation: async (hostgroup) => {
      const res = await apiClient[":fqdn"].hostgroups.$delete({ param: { fqdn: props.fqdn }, json: { hostgroup } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to remove host from group.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });
  const handleRemoveFromGroup = async (groupName: string) => {
    const confirmed = await prompts.confirm(`Remove"${props.fqdn}" from group"${groupName}"?`, {
      title: "Remove from Group",
      icon: "ti ti-folder-minus",
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) {
      await removeFromGroupMutation.mutate(groupName);
    }
  };
  const handleEdit = async () => {
    const result = await prompts.form({
      title: `Edit ${props.fqdn}`,
      icon: "ti ti-pencil",
      confirmText: "Save",
      fields: {
        description: {
          type: "text" as const,
          label: "Description",
          placeholder: "Optional description...",
          default: props.description ?? "",
        },
        locality: { type: "text" as const, label: "Locality", placeholder: "e.g. Stuttgart", default: props.locality ?? "" },
        location: { type: "text" as const, label: "Location", placeholder: "e.g. Room 101", default: props.location ?? "" },
      },
    });
    if (result) {
      await editMutation.mutate({
        description: result.description ?? "",
        locality: result.locality ?? "",
        location: result.location ?? "",
      });
    }
  };
  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Are you sure you want to delete"${props.fqdn}"? This cannot be undone.`, {
      title: "Delete Host",
      icon: "ti ti-trash",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) {
      await deleteMutation.mutate();
    }
  };
  const handleAddToGroup = () => {
    prompts.dialog(
      (close) => (
        <HostgroupSearch
          exclude={props.memberofHostgroup}
          adding={addToGroupMutation.loading()}
          onSelect={async (cn: string) => {
            close();
            await addToGroupMutation.mutate(cn);
          }}
        />
      ),
      { title: "Add to Hostgroup", icon: "ti ti-server-cog" },
    );
  };
  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn h-7 w-7" aria-label="Host actions">
          <i class="ti ti-dots-vertical text-sm" />
        </button>
      }
      position="bottom-left"
      width="w-44"
      elements={[
        {
          items: [
            { icon: "ti ti-pencil", label: "Edit", action: handleEdit },
            { icon: "ti ti-folder-plus", label: "Add", action: handleAddToGroup },
            ...(props.currentGroup
              ? [
                  {
                    icon: "ti ti-folder-minus",
                    label: "Remove",
                    action: () => handleRemoveFromGroup(props.currentGroup!),
                    variant: "danger" as const,
                  },
                ]
              : []),
            { icon: "ti ti-trash", label: "Delete", action: handleDelete, variant: "danger" as const },
          ],
        },
      ]}
    />
  );
}; // Inline hostgroup search component
const HostgroupSearch = (props: { exclude: string[]; adding?: boolean; onSelect: (cn: string) => void }) => {
  const [search, setSearch] = createSignal("");
  const [results, setResults] = createSignal<{ cn: string; description: string | null }[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [addingCn, setAddingCn] = createSignal<string | null>(null);
  const doSearch = async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.hostgroups.search.$get({ query: { q, exclude: props.exclude.join(",") } });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to search hostgroups.");
      }
      const data = await res.json();
      setResults(data.hostgroups);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to search hostgroups.");
    } finally {
      setLoading(false);
    }
  };
  const { debouncedFn: debouncedSearch } = timing.debounce(doSearch, 300);
  const handleInput = (value: string) => {
    setSearch(value);
    debouncedSearch(value);
  };
  return (
    <div class="flex flex-col gap-3">
      <TextInput
        type="search"
        placeholder="Search hostgroups..."
        ariaLabel="Search hostgroups"
        icon="ti ti-search"
        activeIcon="ti ti-search"
        value={search}
        onInput={handleInput}
        clearable
        clearLabel="Clear hostgroup search"
        onClear={() => handleInput("")}
      />
      <div class="h-48 overflow-y-auto">
        <Show when={loading()}>
          <div class="flex items-center justify-center py-8 text-dimmed">
            <i class="ti ti-loader-2 animate-spin text-xl" />
          </div>
        </Show>
        <Show when={!loading() && search().length >= 1 && results().length === 0}>
          <div class="flex flex-col items-center justify-center py-8 text-dimmed text-xs">
            <i class="ti ti-search-off text-xl mb-2" /> <span>No hostgroups found</span>
          </div>
        </Show>
        <Show when={!loading() && search().length < 1}>
          <div class="flex flex-col items-center justify-center py-8 text-dimmed text-xs">
            <i class="ti ti-search text-xl mb-2" /> <span>Type to search hostgroups</span>
          </div>
        </Show>
        <Show when={!loading() && results().length > 0}>
          <div class="flex flex-col gap-1">
            <For each={results()}>
              {(hg) => (
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 h-8 w-8 text-xs">
                    <i class="ti ti-server text-sm" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm truncate">{hg.cn}</div>
                    {hg.description && <div class="text-xs text-dimmed truncate">{hg.description}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingCn(hg.cn);
                      props.onSelect(hg.cn);
                    }}
                    disabled={addingCn() !== null || props.adding}
                    class="p-2 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors disabled:opacity-50"
                    aria-label={`Add to ${hg.cn}`}
                  >
                    <i class={addingCn() === hg.cn ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
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
export default HostActions;
