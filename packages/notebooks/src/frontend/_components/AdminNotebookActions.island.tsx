import { Dropdown, PermissionEditor } from "@valentinkolb/cloud/ui";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { refreshCurrentPath } from "@valentinkolb/cloud/ui";

type AdminNotebookActionsProps = {
  notebookId: string;
  notebookName: string;
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

const openPermissionDialog = async (props: AdminNotebookActionsProps) => {
  const listResponse = await apiClient[":id"].access.$get({
    param: { id: props.notebookId },
  });
  if (!listResponse.ok) {
    await prompts.error(await readErrorMessage(listResponse, "Failed to load notebook permissions."));
    return;
  }

  const entries = (await listResponse.json()) as AccessEntry[];

  await prompts.dialog<void>(
    (_close) => (
      <div class="w-full max-w-full flex flex-col gap-3">
        <p class="text-xs text-dimmed">Manage who can access this notebook.</p>
        <PermissionEditor
          resourceId={props.notebookId}
          initialEntries={entries}
          canEdit
          grantAccess={async (resourceId: string, principal: Principal, permission: PermissionLevel) => {
            const response = await apiClient[":id"].access.$post({
              param: { id: resourceId },
              json: { principal, permission },
            });
            if (!response.ok) {
              throw new Error(await readErrorMessage(response, "Failed to grant access."));
            }
            return (await response.json()) as AccessEntry;
          }}
          updateAccess={async (resourceId: string, accessId: string, permission: PermissionLevel) => {
            const response = await apiClient[":id"].access[":accessId"].$patch({
              param: { id: resourceId, accessId },
              json: { permission },
            });
            if (!response.ok) {
              throw new Error(await readErrorMessage(response, "Failed to update access."));
            }
          }}
          revokeAccess={async (resourceId: string, accessId: string) => {
            const response = await apiClient[":id"].access[":accessId"].$delete({
              param: { id: resourceId, accessId },
            });
            if (!response.ok) {
              throw new Error(await readErrorMessage(response, "Failed to revoke access."));
            }
          }}
        />
      </div>
    ),
    {
      title: props.notebookName,
      icon: "ti ti-shield",
    },
  );
};

const deleteNotebook = async (props: AdminNotebookActionsProps) => {
  const confirmed = await prompts.confirm(`Delete "${props.notebookName}" and all its notes? This cannot be undone.`, {
    title: "Delete Notebook",
    icon: "ti ti-trash",
    confirmText: "Delete",
    variant: "danger",
  });
  if (!confirmed) return;

  const response = await apiClient[":id"].$delete({
    param: { id: props.notebookId },
  });
  if (!response.ok) {
    await prompts.error(await readErrorMessage(response, "Failed to delete notebook."));
    return;
  }

  refreshCurrentPath();
};

const AdminNotebookActions = (props: AdminNotebookActionsProps) => {
  return (
    <Dropdown
      trigger={
        <button
          type="button"
          class="p-1.5 text-dimmed hover:text-primary transition-colors"
          aria-label={`Settings for ${props.notebookName}`}
        >
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
              action: () => void openPermissionDialog(props),
            },
          ],
        },
        {
          items: [
            {
              icon: "ti ti-trash",
              label: "Delete",
              action: () => void deleteNotebook(props),
              variant: "danger",
            },
          ],
        },
      ]}
    />
  );
};

export default AdminNotebookActions;
