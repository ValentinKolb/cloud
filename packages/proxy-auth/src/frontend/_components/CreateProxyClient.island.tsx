import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, CopyButton, prompts, Tag, TextInput } from "@k2b/ui";
import { EntitySearch, type EntitySearchPrincipal } from "@valentinkolb/cloud/account/ui";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { CreateProxyAuthClient, ProxyAuthAllowedGroup, ProxyAuthClient } from "@/contracts";

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
      const verifyUrl = `${window.location.origin}/proxy-auth/verify/${data.clientId}`;

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
            <TextInput label="Name" placeholder="Client name" icon="ti ti-tag" value={name} onValueChange={setName} required />

            <TextInput
              label="Description"
              placeholder="Optional description"
              icon="ti ti-file-description"
              value={description}
              onValueChange={setDescription}
            />

            <div class="flex flex-col gap-1">
              <p class="text-xs text-secondary">Allowed Groups *</p>
              <Show when={groups().length > 0}>
                <div class="flex flex-wrap gap-1 mb-1">
                  <For each={groups()}>
                    {(group) => (
                      <Tag
                        icon="ti ti-users-group"
                        size="sm"
                        onRemove={() => setGroups(groups().filter((candidate) => candidate.id !== group.id))}
                        removeLabel={`Remove ${group.name}`}
                      >
                        {group.name}
                      </Tag>
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

            <div class="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => close(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSubmit}>
                <i class="ti ti-plus" />
                Create
              </Button>
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
    <Button size="sm" onClick={handleCreate}>
      <i class="ti ti-plus" />
      New Client
    </Button>
  );
};

export default CreateProxyClient;
