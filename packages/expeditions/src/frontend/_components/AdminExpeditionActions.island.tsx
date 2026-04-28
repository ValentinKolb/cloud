import { Dropdown, prompts, refreshCurrentPath, PermissionEditor } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";

/**
 * Per-row dropdown on the admin table.
 *
 * The admin page is admin-only, so every action assumes the viewer can do
 * everything — no extra gating. Two entries:
 *
 *   - Permissions → opens the same `<PermissionEditor>` dialog the detail
 *     page uses; sysadmins can override grants for any expedition without
 *     being a member.
 *   - Delete → confirms, deletes, refreshes the table.
 */
type Props = {
  expeditionId: string;
  expeditionTitle: string;
};

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data?.message === "string" && data.message.length > 0) return data.message;
  } catch {
    // ignore
  }
  return fallback;
};

const openPermissions = async (props: Props) => {
  const listRes = await apiClient[":id"].access.$get({ param: { id: props.expeditionId } });
  if (!listRes.ok) {
    prompts.error(await readErrorMessage(listRes, "Failed to load permissions."));
    return;
  }
  const entries = (await listRes.json()) as AccessEntry[];

  await prompts.dialog<void>(
    (_close) => (
      <div class="w-full max-w-full flex flex-col gap-3">
        <p class="text-xs text-dimmed">Manage who can access this expedition.</p>
        <PermissionEditor
          resourceId={props.expeditionId}
          initialEntries={entries}
          canEdit
          grantAccess={async (resourceId: string, principal: Principal, permission: PermissionLevel) => {
            const res = await apiClient[":id"].access.$post({
              param: { id: resourceId },
              json: { principal, permission },
            });
            if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to grant access."));
            return (await res.json()) as AccessEntry;
          }}
          updateAccess={async (resourceId: string, accessId: string, permission: PermissionLevel) => {
            const res = await apiClient[":id"].access[":accessId"].$patch({
              param: { id: resourceId, accessId },
              json: { permission },
            });
            if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update access."));
          }}
          revokeAccess={async (resourceId: string, accessId: string) => {
            const res = await apiClient[":id"].access[":accessId"].$delete({
              param: { id: resourceId, accessId },
            });
            if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke access."));
          }}
        />
      </div>
    ),
    { title: props.expeditionTitle, icon: "ti ti-shield" },
  );
};

const deleteExpedition = async (props: Props) => {
  const ok = await prompts.confirm(`Delete "${props.expeditionTitle}" and all its waypoints? This cannot be undone.`, {
    title: "Delete expedition",
    icon: "ti ti-trash",
    confirmText: "Delete",
    variant: "danger",
  });
  if (!ok) return;

  const res = await apiClient[":id"].$delete({ param: { id: props.expeditionId } });
  if (!res.ok) {
    prompts.error(await readErrorMessage(res, "Failed to delete expedition."));
    return;
  }
  refreshCurrentPath();
};

const AdminExpeditionActions = (props: Props) => {
  return (
    <Dropdown
      trigger={
        <button
          type="button"
          class="p-1.5 text-dimmed hover:text-primary transition-colors"
          aria-label={`Actions for ${props.expeditionTitle}`}
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
              action: () => void openPermissions(props),
            },
          ],
        },
        {
          items: [
            {
              icon: "ti ti-trash",
              label: "Delete",
              action: () => void deleteExpedition(props),
              variant: "danger",
            },
          ],
        },
      ]}
    />
  );
};

export default AdminExpeditionActions;
