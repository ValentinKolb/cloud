import { Dropdown, EntitySearch, type EntitySearchPrincipal, prompts, TextInput, Tooltip, toast } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@k2b/ssr/nav";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ProxyAuthAllowedGroup, ProxyAuthClient, UpdateProxyAuthClient } from "@/contracts";

type Props = {
  client: ProxyAuthClient;
};

const ProxyClientActions = (props: Props) => {
  const { client } = props;

  const updateMutation = mutations.create<{ message: string }, UpdateProxyAuthClient>({
    mutation: async (data) => {
      const res = await apiClient[":id"].$put({
        param: { id: client.id },
        json: data,
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error((result as { message?: string }).message ?? "Failed to update client.");
      }
      return result as { message: string };
    },
    onSuccess: () => {
      toast.success("Proxy auth client updated");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create<{ message: string }, void>({
    mutation: async () => {
      const res = await apiClient[":id"].$delete({
        param: { id: client.id },
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error((result as { message?: string }).message ?? "Failed to delete client.");
      }
      return result as { message: string };
    },
    onSuccess: () => {
      toast.success("Proxy auth client deleted");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleEdit = async () => {
    const result = await prompts.dialog<UpdateProxyAuthClient | null>(
      (close) => {
        const [description, setDescription] = createSignal(client.description ?? "");
        const [groups, setGroups] = createSignal<ProxyAuthAllowedGroup[]>([...client.allowedGroups]);

        const handleGroupSelect = (r: EntitySearchPrincipal) => {
          if (r.type === "group" && !groups().some((group) => group.id === r.groupId)) {
            setGroups([...groups(), { id: r.groupId, name: r.name, provider: r.provider }]);
          }
        };

        const handleSubmit = () => {
          if (groups().length === 0) {
            prompts.error("At least one group is required.");
            return;
          }
          close({
            description: description().trim() || null,
            allowedGroupIds: groups().map((group) => group.id),
          });
        };

        return (
          <div class="flex flex-col gap-4">
            <div class="text-xs text-dimmed info-block-info p-2 rounded">
              Client ID: <code class="bg-zinc-50 dark:bg-zinc-800 px-1 rounded">{client.clientId}</code>
            </div>

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
                        <Tooltip content={`Remove ${group.name}`}>
                          <button
                            type="button"
                            onClick={() => setGroups(groups().filter((candidate) => candidate.id !== group.id))}
                            class="hover:text-red-500 ml-0.5"
                            aria-label={`Remove ${group.name}`}
                          >
                            <i class="ti ti-x text-[10px]" />
                          </button>
                        </Tooltip>
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

            <div class="flex items-center justify-end gap-2">
              <button type="button" class="btn-simple btn-sm" onClick={() => close(null)}>
                Cancel
              </button>
              <button type="button" class="btn-primary btn-sm" onClick={handleSubmit}>
                <i class="ti ti-check" />
                Save
              </button>
            </div>
          </div>
        );
      },
      { title: `Edit: ${client.name}`, icon: "ti ti-pencil" },
    );

    if (result) {
      await updateMutation.mutate(result);
    }
  };

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Are you sure you want to delete "${client.name}"?`, {
      title: "Delete Client?",
      icon: "ti ti-trash",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) {
      await deleteMutation.mutate();
    }
  };

  const handleCopyVerifyUrl = async () => {
    const baseUrl = window.location.origin;
    try {
      await clipboard.copy(`${baseUrl}/proxy-auth/verify/${client.clientId}`);
      toast.success("Verify URL copied");
    } catch {
      toast.error("Could not copy Verify URL");
    }
  };

  return (
    <Dropdown
      trigger={
        <Tooltip content="Proxy auth client actions">
          <button type="button" class="icon-btn h-7 w-7" aria-label="Proxy auth client actions">
            <i class="ti ti-dots-vertical text-sm" />
          </button>
        </Tooltip>
      }
      position="bottom-left"
      width="w-48"
      elements={[
        {
          items: [
            {
              icon: "ti ti-copy",
              label: "Copy Verify URL",
              action: handleCopyVerifyUrl,
            },
            {
              icon: "ti ti-pencil",
              label: "Edit",
              action: handleEdit,
            },
          ],
        },
        {
          items: [
            {
              icon: "ti ti-trash",
              label: "Delete",
              action: handleDelete,
              variant: "danger",
            },
          ],
        },
      ]}
    />
  );
};

export default ProxyClientActions;
