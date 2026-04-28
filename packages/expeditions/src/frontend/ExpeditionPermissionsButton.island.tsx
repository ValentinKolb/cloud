import { apiClient } from "@/api/client";
import { PermissionEditor, prompts } from "@valentinkolb/cloud/ui";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";

/**
 * Wraps the platform's `<PermissionEditor>` in a dialog.
 *
 * The editor itself is generic — it just needs three callbacks (grant /
 * update / revoke) and an initial list of entries. Each callback talks to
 * this app's `/access` endpoints via the typed RPC client.
 *
 * Showing this button is gated by `isAdmin` on the parent page; the API
 * also enforces it (admins-only).
 */
type Props = {
  expeditionId: string;
  expeditionTitle: string;
};

/** Pull a `message` field out of an error response, fall back to a default. */
const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data?.message === "string" && data.message.length > 0) {
      return data.message;
    }
  } catch {
    // ignore parse errors
  }
  return fallback;
};

const ExpeditionPermissionsButton = (props: Props) => {
  const handleClick = async () => {
    // Prefetch the current entries so the editor opens with a list, not a spinner.
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

  return (
    <button
      type="button"
      onClick={handleClick}
      class="text-dimmed hover:text-primary transition-colors p-1.5"
      aria-label="Manage permissions"
    >
      <i class="ti ti-shield text-sm" />
    </button>
  );
};

export default ExpeditionPermissionsButton;
