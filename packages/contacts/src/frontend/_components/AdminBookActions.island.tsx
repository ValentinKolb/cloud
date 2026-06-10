import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { Dropdown, PermissionEditor, prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import { readErrorMessage } from "./api";

type AdminBookActionsProps = {
  bookId: string;
  bookName: string;
};

const loadAccessEntries = async (props: AdminBookActionsProps): Promise<AccessEntry[]> => {
  const listResponse = await apiClient.admin.books[":bookId"].access.$get({
    param: { bookId: props.bookId },
  });
  if (!listResponse.ok) {
    throw new Error(await readErrorMessage(listResponse, "Failed to load contact book permissions."));
  }

  return listResponse.json();
};

const openPermissionDialog = async (props: AdminBookActionsProps, entries: AccessEntry[]) => {
  await prompts.dialog<void>(
    () => (
      <div class="w-full max-w-full flex flex-col gap-3">
        <p class="text-xs text-dimmed">Manage who can access this contact book.</p>
        <PermissionEditor
          initialEntries={entries.filter((entry) => entry.principal.type !== "service_account")}
          canEdit
          grantAccess={async (principal, permission) => {
            const response = await apiClient.admin.books[":bookId"].access.$post({
              param: { bookId: props.bookId },
              json: { principal, permission },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access."));
            return await response.json();
          }}
          updateAccess={async (accessId, permission) => {
            const response = await apiClient.admin.books[":bookId"].access[":accessId"].$patch({
              param: { bookId: props.bookId, accessId },
              json: { permission },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access."));
          }}
          revokeAccess={async (accessId) => {
            const response = await apiClient.admin.books[":bookId"].access[":accessId"].$delete({
              param: { bookId: props.bookId, accessId },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access."));
          }}
        />
      </div>
    ),
    {
      title: props.bookName,
      icon: "ti ti-shield",
    },
  );
  refreshCurrentPath();
};

const AdminBookActions = (props: AdminBookActionsProps) => {
  const permissionDialogMutation = mutations.create<AccessEntry[], void>({
    mutation: async () => loadAccessEntries(props),
    onSuccess: (entries) => {
      void openPermissionDialog(props, entries);
    },
    onError: (error) => {
      void prompts.error(error.message);
    },
  });

  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn h-7 w-7" aria-label={`Settings for ${props.bookName}`}>
          <i class={permissionDialogMutation.loading() ? "ti ti-loader-2 animate-spin text-sm" : "ti ti-settings text-sm"} />
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
              action: () => permissionDialogMutation.mutate(undefined),
            },
          ],
        },
      ]}
    />
  );
};

export default AdminBookActions;
