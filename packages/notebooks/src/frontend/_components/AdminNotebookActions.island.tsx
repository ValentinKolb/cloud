import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { Dropdown, PermissionEditor, prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";

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
      <div class="flex w-full max-w-full flex-col gap-2">
        <p class="text-xs text-dimmed">Manage who can access this notebook.</p>
        <PermissionEditor
          initialEntries={entries}
          canEdit
          grantAccess={async (principal, permission) => {
            const response = await apiClient[":id"].access.$post({
              param: { id: props.notebookId },
              json: { principal, permission },
            });
            if (!response.ok) {
              throw new Error(await readErrorMessage(response, "Failed to grant access."));
            }
            return (await response.json()) as AccessEntry;
          }}
          updateAccess={async (accessId, permission) => {
            const response = await apiClient[":id"].access[":accessId"].$patch({
              param: { id: props.notebookId, accessId },
              json: { permission },
            });
            if (!response.ok) {
              throw new Error(await readErrorMessage(response, "Failed to update access."));
            }
          }}
          revokeAccess={async (accessId) => {
            const response = await apiClient[":id"].access[":accessId"].$delete({
              param: { id: props.notebookId, accessId },
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
