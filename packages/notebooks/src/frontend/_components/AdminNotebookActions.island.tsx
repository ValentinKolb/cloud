import { refreshCurrentPath } from "@k2b/ssr/nav";
import { query } from "@k2b/stdlib/solid";
import { Button, Dropdown, Placeholder, prompts, toast } from "@k2b/ui";
import { PermissionEditor } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { createSignal, Show } from "solid-js";
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

const PermissionDialogBody = (props: AdminNotebookActionsProps) => {
  const entries = query.create({
    source: () => props.notebookId,
    load: async (notebookId, { abortSignal }): Promise<AccessEntry[]> => {
      const response = await apiClient[":id"].access.$get({ param: { id: notebookId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load notebook permissions."));
      return (await response.json()) as AccessEntry[];
    },
  });
  const [reconcileError, setReconcileError] = createSignal<string | null>(null);
  const reconcile = () => {
    setReconcileError(null);
    void entries.invalidate().catch(() => setReconcileError("The change was saved, but notebook access could not be reloaded."));
  };

  return (
    <div class="flex w-full max-w-full flex-col gap-2">
      <p class="text-xs text-dimmed">Manage who can access this notebook.</p>
      <Show when={!entries.loading()} fallback={<Placeholder state="loading" title="Loading notebook access" />}>
        <Show
          when={entries.data()}
          keyed
          fallback={
            <Placeholder
              state="error"
              title="Could not load notebook access"
              description={entries.error()?.message}
              action={
                <Button type="button" variant="secondary" size="sm" onClick={() => void entries.refresh()}>
                  Retry
                </Button>
              }
            />
          }
        >
          {(currentEntries) => (
            <PermissionEditor
              initialEntries={currentEntries}
              canEdit
              grantAccess={async (principal, permission) => {
                const response = await apiClient[":id"].access.$post({
                  param: { id: props.notebookId },
                  json: { principal, permission },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access."));
                const created = (await response.json()) as AccessEntry;
                reconcile();
                return created;
              }}
              updateAccess={async (accessId, permission) => {
                const response = await apiClient[":id"].access[":accessId"].$patch({
                  param: { id: props.notebookId, accessId },
                  json: { permission },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access."));
                reconcile();
              }}
              revokeAccess={async (accessId) => {
                const response = await apiClient[":id"].access[":accessId"].$delete({
                  param: { id: props.notebookId, accessId },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access."));
                reconcile();
              }}
            />
          )}
        </Show>
      </Show>
      <Show when={reconcileError()}>
        <div class="flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300">
          <span>{reconcileError()}</span>
          <Button type="button" variant="secondary" size="sm" onClick={reconcile} disabled={entries.refreshing()}>
            Retry reload
          </Button>
        </div>
      </Show>
    </div>
  );
};

const openPermissionDialog = (props: AdminNotebookActionsProps) =>
  prompts.dialog<void>(() => <PermissionDialogBody {...props} />, { title: props.notebookName, icon: "ti ti-shield" });

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

  toast.success("Notebook deleted");
  refreshCurrentPath();
};

const AdminNotebookActions = (props: AdminNotebookActionsProps) => {
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
              action: () => void deleteNotebook(props),
              variant: "danger",
            },
          ],
        },
      ]}
    >
      <Dropdown.Trigger iconOnly label={`Actions for ${props.notebookName}`} size="xs" tooltip="Notebook actions">
        <i class="ti ti-settings text-sm" />
      </Dropdown.Trigger>
    </Dropdown.Root>
  );
};

export default AdminNotebookActions;
