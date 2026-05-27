import { Dropdown, PermissionEditor, prompts, refreshCurrentPath, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
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

const openPermissionDialog = async (props: AdminSpaceActionsProps, entries: AccessEntry[]) => {
  await prompts.dialog<void>(
    (_close) => (
      <div class="w-full max-w-full flex flex-col gap-3">
        <p class="text-xs text-dimmed">Manage who can access this space.</p>
        <PermissionEditor
          initialEntries={entries}
          canEdit
          grantAccess={async (principal, permission) => {
            const response = await apiClient[":id"].access.$post({
              param: { id: props.spaceId },
              json: { principal, permission },
            });
            if (!response.ok) {
              throw new Error(await readErrorMessage(response, "Failed to grant access."));
            }
            return (await response.json()) as AccessEntry;
          }}
          updateAccess={async (accessId, permission) => {
            const response = await apiClient[":id"].access[":accessId"].$patch({
              param: { id: props.spaceId, accessId },
              json: { permission },
            });
            if (!response.ok) {
              throw new Error(await readErrorMessage(response, "Failed to update access."));
            }
          }}
          revokeAccess={async (accessId) => {
            const response = await apiClient[":id"].access[":accessId"].$delete({
              param: { id: props.spaceId, accessId },
            });
            if (!response.ok) {
              throw new Error(await readErrorMessage(response, "Failed to revoke access."));
            }
          }}
        />
      </div>
    ),
    {
      title: props.spaceName,
      icon: "ti ti-shield",
    },
  );
};

const AdminSpaceActions = (props: AdminSpaceActionsProps) => {
  const permissionsMutation = mutations.create<void, void>({
    mutation: async () => {
      const listResponse = await apiClient[":id"].access.$get({
        param: { id: props.spaceId },
      });
      if (!listResponse.ok) {
        throw new Error(await readErrorMessage(listResponse, "Failed to load space permissions."));
      }

      const entries = (await listResponse.json()) as AccessEntry[];
      await openPermissionDialog(props, entries);
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(`Delete "${props.spaceName}" and all its items? This cannot be undone.`, {
        title: "Delete Space",
        icon: "ti ti-trash",
        confirmText: "Delete",
        variant: "danger",
      });
      if (!confirmed) return false;

      const response = await apiClient[":id"].$delete({
        param: { id: props.spaceId },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to delete space."));
      }
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Space deleted");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <Dropdown
      trigger={
        <button type="button" class="p-1.5 text-dimmed hover:text-primary transition-colors" aria-label={`Settings for ${props.spaceName}`}>
          <i class="ti ti-settings text-sm" />
        </button>
      }
      position="bottom-left"
      width="w-52"
      elements={[
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
    />
  );
};

export default AdminSpaceActions;
