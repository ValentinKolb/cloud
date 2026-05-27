import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { Dropdown, PermissionEditor, prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";

type AdminBookActionsProps = {
  bookId: string;
  bookName: string;
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

const openPermissionDialog = async (props: AdminBookActionsProps) => {
  const listResponse = await fetch(`/api/contacts/admin/books/${encodeURIComponent(props.bookId)}/access`);
  if (!listResponse.ok) {
    await prompts.error(await readErrorMessage(listResponse, "Failed to load contact book permissions."));
    return;
  }

  const entries = (await listResponse.json()) as AccessEntry[];

  await prompts.dialog<void>(
    () => (
      <div class="w-full max-w-full flex flex-col gap-3">
        <p class="text-xs text-dimmed">Manage who can access this contact book.</p>
        <PermissionEditor
          initialEntries={entries}
          canEdit
          grantAccess={async (principal, permission) => {
            const response = await fetch(`/api/contacts/admin/books/${encodeURIComponent(props.bookId)}/access`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ principal, permission }),
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access."));
            return (await response.json()) as AccessEntry;
          }}
          updateAccess={async (accessId, permission) => {
            const response = await fetch(
              `/api/contacts/admin/books/${encodeURIComponent(props.bookId)}/access/${encodeURIComponent(accessId)}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ permission }),
              },
            );
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access."));
          }}
          revokeAccess={async (accessId) => {
            const response = await fetch(
              `/api/contacts/admin/books/${encodeURIComponent(props.bookId)}/access/${encodeURIComponent(accessId)}`,
              { method: "DELETE" },
            );
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

const AdminBookActions = (props: AdminBookActionsProps) => (
  <Dropdown
    trigger={
      <button type="button" class="p-1.5 text-dimmed hover:text-primary transition-colors" aria-label={`Settings for ${props.bookName}`}>
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
    ]}
  />
);

export default AdminBookActions;
