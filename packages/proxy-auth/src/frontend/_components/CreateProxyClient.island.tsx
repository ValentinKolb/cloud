import { createSignal, For, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import {
  prompts,
  CopyButton,
  TextInput,
  EntitySearch,
  type EntitySearchPrincipal,
  refreshCurrentPath,
} from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { ProxyAuthAllowedGroup, ProxyAuthClient, CreateProxyAuthClient } from "@/contracts";

const CreateProxyClient = () => {
  const mutation = mutations.create<ProxyAuthClient, CreateProxyAuthClient>({
    mutation: async (data) => {
      const res = await apiClient.index.$post({ json: data });
      const result = await res.json();
      if (!res.ok) {
        throw new Error((result as { message?: string }).message ?? "Failed to create client.");
      }
      return result as ProxyAuthClient;
    },
    onSuccess: async (data) => {
      const verifyUrl = `${window.location.origin}/api/proxy-auth/verify/${data.clientId}`;

      await prompts.alert(
        <div class="space-y-4">
          <div>
            <div class="text-xs text-dimmed mb-1">Verify URL</div>
            <div class="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2">
              <code class="text-sm flex-1 break-all">{verifyUrl}</code>
              <CopyButton text={verifyUrl} />
            </div>
          </div>
          <div class="text-xs text-dimmed">You can copy this URL later from the client actions menu.</div>
        </div>,
        { title: "Client Created", icon: "ti ti-check" },
      );
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCreate = async () => {
    const result = await prompts.dialog<CreateProxyAuthClient | null>(
      (close) => {
        const [name, setName] = createSignal("");
        const [description, setDescription] = createSignal("");
        const [groups, setGroups] = createSignal<ProxyAuthAllowedGroup[]>([]);

        const handleGroupSelect = (r: EntitySearchPrincipal) => {
          if (r.type === "group" && !groups().some((group) => group.id === r.groupId)) {
            setGroups([...groups(), { id: r.groupId, name: r.name, provider: r.provider }]);
          }
        };

        const handleSubmit = () => {
          if (!name().trim()) {
            prompts.error("Name is required.");
            return;
          }
          if (groups().length === 0) {
            prompts.error("At least one group is required.");
            return;
          }
          close({
            name: name().trim(),
            description: description().trim() || undefined,
            allowedGroupIds: groups().map((group) => group.id),
          });
        };

        return (
          <div class="flex flex-col gap-4">
            <TextInput label="Name" placeholder="Client name" icon="ti ti-tag" value={name} onChange={setName} required />

            <TextInput
              label="Description"
              placeholder="Optional description"
              icon="ti ti-file-description"
              value={description}
              onChange={setDescription}
            />

            <div class="flex flex-col gap-1">
              <p class="text-xs text-secondary">Allowed Groups *</p>
              <Show when={groups().length > 0}>
                <div class="flex flex-wrap gap-1 mb-1">
                  <For each={groups()}>
                    {(group) => (
                      <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-400">
                        <i class="ti ti-users-group text-[10px]" />
                        {group.name}
                        <button
                          type="button"
                          onClick={() => setGroups(groups().filter((candidate) => candidate.id !== group.id))}
                          class="hover:text-red-500 ml-0.5"
                        >
                          <i class="ti ti-x text-[10px]" />
                        </button>
                      </span>
                    )}
                  </For>
                </div>
              </Show>
                <EntitySearch
                  includeGroups
                  excludeGroupIds={groups().map((group) => group.id)}
                  onSelect={handleGroupSelect}
                  placeholder="Search groups..."
                />
            </div>

            <div class="flex items-center gap-2 justify-end border-t border-zinc-200 dark:border-zinc-700 pt-4">
              <button type="button" class="btn-simple btn-sm" onClick={() => close(null)}>
                Cancel
              </button>
              <button type="button" class="btn-primary btn-sm" onClick={handleSubmit}>
                <i class="ti ti-plus" />
                Create
              </button>
            </div>
          </div>
        );
      },
      { title: "New Proxy Auth Client", icon: "ti ti-plus" },
    );

    if (result) {
      await mutation.mutate(result);
    }
  };

  return (
    <button type="button" class="btn-primary btn-sm" onClick={handleCreate}>
      <i class="ti ti-plus" />
      New Client
    </button>
  );
};

export default CreateProxyClient;
