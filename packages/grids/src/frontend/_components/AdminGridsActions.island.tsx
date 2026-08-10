import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Dropdown, IconButton, prompts, toast } from "@k2b/ui";
import { PermissionEditor } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";

type AdminGridsActionsProps = {
  baseId: string;
  baseName: string;
};

type ScopedAccessEntry = AccessEntry & {
  resourceType: "base" | "customApp";
  resourceId: string;
  resourceName: string;
  tableId: string | null;
  tableName: string | null;
};

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data?.message === "string" && data.message.length > 0) return data.message;
  } catch {
    // ignore parse errors and use fallback
  }
  return fallback;
};

const listBaseAccess = async (baseId: string): Promise<ScopedAccessEntry[]> => {
  const response = await apiClient.admin.bases[":baseId"].access.$get({
    param: { baseId },
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load base permissions."));
  return (await response.json()) as ScopedAccessEntry[];
};

const entryLabel = (entry: AccessEntry): string => {
  if (entry.displayName) return entry.displayName;
  if (entry.principal.type === "authenticated") return "Signed-in users";
  if (entry.principal.type === "public") return "Public";
  if (entry.principal.type === "user") return entry.principal.userId;
  if (entry.principal.type === "group") return entry.principal.groupId;
  return entry.principal.serviceAccountId;
};

const openPermissionDialog = async (props: AdminGridsActionsProps, entries: ScopedAccessEntry[]) => {
  const PermissionDialog = () => {
    const [scopedEntries, setScopedEntries] = createSignal(entries);
    const baseEntries = createMemo(() => scopedEntries().filter((entry) => entry.resourceType === "base"));
    const customAppEntries = createMemo(() => scopedEntries().filter((entry) => entry.resourceType === "customApp"));

    const revokeCustomAppEntryMutation = mutations.create<ScopedAccessEntry, ScopedAccessEntry>({
      mutation: async (entry) => {
        const response = await apiClient.admin.bases[":baseId"].access[":accessId"].$delete({
          param: { baseId: props.baseId, accessId: entry.id },
        });
        if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke Custom App access."));
        return entry;
      },
      onSuccess: (entry) => {
        setScopedEntries((current) => current.filter((item) => item.id !== entry.id));
        toast.success("Custom App access revoked");
      },
      onError: (err) => prompts.error(err.message),
    });

    return (
      <div class="flex w-full max-w-full flex-col gap-4">
        <div class="flex flex-col gap-2">
          <p class="text-xs text-dimmed">Base grants control direct access to every table, view, form, and document in this Base.</p>
          <PermissionEditor
            initialEntries={baseEntries()}
            canEdit
            allowPublic={false}
            grantAccess={async (principal, permission) => {
              const response = await apiClient.admin.bases[":baseId"].access.$post({
                param: { baseId: props.baseId },
                json: { principal, permission },
              });
              if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access."));
              const created = (await response.json()) as AccessEntry;
              setScopedEntries((current) => [
                ...current,
                {
                  ...created,
                  resourceType: "base",
                  resourceId: props.baseId,
                  resourceName: props.baseName,
                  tableId: null,
                  tableName: null,
                },
              ]);
              toast.success("Access granted");
              return created;
            }}
            updateAccess={async (accessId, permission) => {
              const response = await apiClient.admin.bases[":baseId"].access[":accessId"].$patch({
                param: { baseId: props.baseId, accessId },
                json: { permission },
              });
              if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access."));
              setScopedEntries((current) => current.map((entry) => (entry.id === accessId ? { ...entry, permission } : entry)));
              toast.success("Access updated");
            }}
            revokeAccess={async (accessId) => {
              const response = await apiClient.admin.bases[":baseId"].access[":accessId"].$delete({
                param: { baseId: props.baseId, accessId },
              });
              if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access."));
              setScopedEntries((current) => current.filter((entry) => entry.id !== accessId));
              toast.success("Access revoked");
            }}
          />
        </div>

        <Show when={customAppEntries().length > 0}>
          <div class="flex flex-col gap-2 pt-1">
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Custom App access</h3>
              <p class="text-xs text-dimmed">Custom Apps have independent grants and never inherit access from the Base.</p>
            </div>
            <div class="flex flex-col">
              <For each={customAppEntries()}>
                {(entry) => (
                  <div class="grid grid-cols-[1fr_auto] items-center gap-3 px-1 py-2">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-default">{entry.resourceName}</div>
                      <div class="truncate text-xs text-dimmed">
                        {entryLabel(entry)} · {entry.permission}
                      </div>
                    </div>
                    <IconButton
                      variant="ghost"
                      size="xs"
                      class="text-dimmed hover:text-default"
                      label={`Revoke Custom App access for ${entryLabel(entry)}`}
                      disabled={revokeCustomAppEntryMutation.loading()}
                      onClick={() => revokeCustomAppEntryMutation.mutate(entry)}
                    >
                      <i class="ti ti-x text-sm" />
                    </IconButton>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    );
  };

  await prompts.dialog<void>(() => <PermissionDialog />, {
    title: props.baseName,
    icon: "ti ti-shield",
  });
};

const AdminGridsActions = (props: AdminGridsActionsProps) => {
  const permissionsMutation = mutations.create<void, void>({
    mutation: async () => {
      await openPermissionDialog(props, await listBaseAccess(props.baseId));
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(`Delete "${props.baseName}" and all records? This can be restored from the database only.`, {
        title: "Delete Base",
        icon: "ti ti-trash",
        confirmText: "Delete",
        variant: "danger",
      });
      if (!confirmed) return false;

      const response = await apiClient.admin.bases[":baseId"].$delete({
        param: { baseId: props.baseId },
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete base."));
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Base deleted");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <Dropdown.Root
      position="bottom-left"
      width="13rem"
      items={[
        {
          items: [
            {
              icon: "ti ti-shield",
              label: "Permissions",
              action: () => void permissionsMutation.mutate(undefined),
            },
          ],
        },
        {
          items: [
            {
              icon: "ti ti-trash",
              label: "Delete",
              action: () => void deleteMutation.mutate(undefined),
              variant: "danger",
            },
          ],
        },
      ]}
    >
      <Dropdown.Trigger
        iconOnly
        variant="ghost"
        size="sm"
        type="button"
        class="h-7 w-7"
        label={`Actions for ${props.baseName}`}
        tooltip="Base actions"
      >
        <i
          class={
            permissionsMutation.loading() || deleteMutation.loading() ? "ti ti-loader-2 animate-spin text-sm" : "ti ti-settings text-sm"
          }
        />
      </Dropdown.Trigger>
    </Dropdown.Root>
  );
};

export default AdminGridsActions;
