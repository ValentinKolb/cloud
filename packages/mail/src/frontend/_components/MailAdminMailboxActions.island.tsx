import { refreshCurrentPath } from "@k2b/ssr/nav";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { PermissionEditor, prompts, Tooltip } from "@valentinkolb/cloud/ui";
import { mutation } from "@k2b/stdlib/solid";
import { apiClient } from "../../api/client";

type MailAdminMailboxActionsProps = {
  mailboxId: string;
  mailboxName: string;
};

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message?.trim() || fallback;
  } catch {
    return fallback;
  }
};

const loadAccess = async (mailboxId: string): Promise<AccessEntry[]> => {
  const response = await apiClient.admin.mailboxes[":mailboxId"].access.$get({ param: { mailboxId } });
  if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load mailbox permissions."));
  return response.json();
};

const openPermissionDialog = async (props: MailAdminMailboxActionsProps, entries: AccessEntry[]) => {
  await prompts.dialog<void>(
    () => (
      <div class="flex w-full max-w-full flex-col gap-3">
        <p class="text-xs text-dimmed">Repair access without opening mailbox content. A mailbox must keep at least one administrator.</p>
        <PermissionEditor
          initialEntries={entries}
          canEdit
          allowAuthenticated={false}
          allowServiceAccounts
          grantAccess={async (principal, permission) => {
            const response = await apiClient.admin.mailboxes[":mailboxId"].access.$post({
              param: { mailboxId: props.mailboxId },
              json: { principal, permission },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant mailbox access."));
            return response.json();
          }}
          updateAccess={async (accessId, permission) => {
            const response = await apiClient.admin.mailboxes[":mailboxId"].access[":accessId"].$patch({
              param: { mailboxId: props.mailboxId, accessId },
              json: { permission },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update mailbox access."));
          }}
          revokeAccess={async (accessId) => {
            const response = await apiClient.admin.mailboxes[":mailboxId"].access[":accessId"].$delete({
              param: { mailboxId: props.mailboxId, accessId },
            });
            if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke mailbox access."));
          }}
        />
      </div>
    ),
    { title: `${props.mailboxName} permissions`, icon: "ti ti-shield" },
  );
  refreshCurrentPath();
};

export default function MailAdminMailboxActions(props: MailAdminMailboxActionsProps) {
  const accessMutation = mutation.create<AccessEntry[], void>({
    mutation: () => loadAccess(props.mailboxId),
    onSuccess: (entries) => void openPermissionDialog(props, entries),
    onError: (error) => void prompts.error(error.message),
  });

  return (
    <Tooltip content="Manage permissions">
      <button
        type="button"
        class="icon-btn h-7 w-7"
        aria-label={`Manage permissions for ${props.mailboxName}`}
        disabled={accessMutation.loading()}
        onClick={() => accessMutation.mutate(undefined)}
      >
        <i class={accessMutation.loading() ? "ti ti-loader-2 animate-spin text-sm" : "ti ti-shield text-sm"} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
