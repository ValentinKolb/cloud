import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations, query } from "@k2b/stdlib/solid";
import { Button, Dropdown, Placeholder, prompts, toast } from "@k2b/ui";
import { PermissionEditor } from "@valentinkolb/cloud/access/ui";
import { Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { AccessEntry } from "@/contracts";

type AdminSpaceActionsProps = {
  spaceId: string;
  spaceName: string;
};

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data?.message === "string" && data.message.length > 0) {
      return data.message;
    }
  } catch {
    // ignore parse errors and use fallback
  }
  return fallback;
};

const PermissionDialogContent = (props: AdminSpaceActionsProps) => {
  const permissions = query.create<string, AccessEntry[]>({
    source: () => props.spaceId,
    load: async (spaceId, { abortSignal }) => {
      const response = await apiClient.admin[":id"].access.$get({ param: { id: spaceId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load space permissions."));
      return response.json();
    },
  });

  return (
    <Show
      when={permissions.data()}
      fallback={
        permissions.error() ? (
          <Placeholder
            state="error"
            variant="compact"
            title="Could not load permissions"
            description={permissions.error()!.message}
            action={
              <Button type="button" variant="secondary" size="sm" onClick={() => void permissions.refresh()}>
                Retry
              </Button>
            }
          />
        ) : (
          <Placeholder state="loading" variant="compact" title="Loading permissions" />
        )
      }
    >
      {(entries) => (
        <PermissionEditor
          initialEntries={entries()}
          canEdit
          grantAccess={async (principal, permission) => {
            const response = await apiClient.admin[":id"].access.$post({
              param: { id: props.spaceId },
              json: { principal, permission },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access."));
            return (await response.json()) as AccessEntry;
          }}
          updateAccess={async (accessId, permission) => {
            const response = await apiClient.admin[":id"].access[":accessId"].$patch({
              param: { id: props.spaceId, accessId },
              json: { permission },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access."));
          }}
          revokeAccess={async (accessId) => {
            const response = await apiClient.admin[":id"].access[":accessId"].$delete({
              param: { id: props.spaceId, accessId },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access."));
          }}
        />
      )}
    </Show>
  );
};

const openPermissionDialog = async (props: AdminSpaceActionsProps) => {
  await prompts.dialog<void>(
    (_close) => (
      <div class="w-full max-w-full flex flex-col gap-3">
        <p class="text-xs text-dimmed">Manage who can access this space.</p>
        <PermissionDialogContent {...props} />
      </div>
    ),
    {
      title: props.spaceName,
      icon: "ti ti-shield",
    },
  );
};

const AdminSpaceActions = (props: AdminSpaceActionsProps) => {
  const deleteMutation = mutations.create<void, { spaceId: string }>({
    mutation: async ({ spaceId }) => {
      const response = await apiClient.admin[":id"].$delete({
        param: { id: spaceId },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to delete space."));
      }
    },
    onSuccess: () => {
      toast.success("Space deleted");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });
  let deletePromptPending = false;
  const deleteSpace = async () => {
    if (deletePromptPending || deleteMutation.loading()) return;
    deletePromptPending = true;
    try {
      const confirmed = await prompts.confirm(`Delete "${props.spaceName}" and all its items? This cannot be undone.`, {
        title: "Delete Space",
        icon: "ti ti-trash",
        confirmText: "Delete",
        variant: "danger",
      });
      if (confirmed) void deleteMutation.mutate({ spaceId: props.spaceId });
    } finally {
      deletePromptPending = false;
    }
  };

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
              action: () => void openPermissionDialog(props),
            },
          ],
        },
        {
          items: [
            {
              icon: "ti ti-trash",
              label: "Delete",
              action: () => void deleteSpace(),
              variant: "danger",
            },
          ],
        },
      ]}
    >
      <Dropdown.Trigger iconOnly label={`Actions for ${props.spaceName}`} size="sm" class="h-7 w-7" tooltip="Space actions">
        <i class={deleteMutation.loading() ? "ti ti-loader-2 animate-spin text-sm" : "ti ti-settings text-sm"} />
      </Dropdown.Trigger>
    </Dropdown.Root>
  );
};

export default AdminSpaceActions;
