import { createSignal } from "solid-js";
import { prompts, refreshCurrentPath, PermissionEditor } from "@valentinkolb/cloud/ui";
import type {
  AccessEntry,
  PermissionLevel,
  Principal,
} from "@valentinkolb/cloud/contracts";
import { apiClient } from "@/api/client";

type Props = {
  baseId: string;
  initialEntries: AccessEntry[];
  canManage: boolean;
};

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = (await res.json()) as { message?: string };
    if (typeof data.message === "string" && data.message.length > 0) return data.message;
  } catch {}
  return fallback;
};

/**
 * Opens the platform `PermissionEditor` inside a dialog, wired to grids'
 * per-base ACL routes. Grant / update / revoke each call apiClient.access.
 * Editor refreshes itself optimistically; we trigger SSR re-render via
 * refreshCurrentPath when the dialog closes so the sidebar reflects the
 * new state.
 */
export default function BasePermissions(props: Props) {
  const [entries, setEntries] = createSignal(props.initialEntries);

  const open = async () => {
    await prompts.dialog<void>(
      () => (
        <PermissionEditor
          resourceId={props.baseId}
          initialEntries={entries()}
          canEdit={props.canManage}
          grantAccess={async (resourceId: string, principal: Principal, permission: PermissionLevel) => {
            const res = await apiClient.access["by-base"][":baseId"].$post({
              param: { baseId: resourceId },
              json: { principal, permission },
            });
            if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
            const created = (await res.json()) as { accessId: string };
            // Re-fetch the canonical entry shape to populate displayName etc.
            const listRes = await apiClient.access["by-base"][":baseId"].$get({
              param: { baseId: resourceId },
            });
            const list = listRes.ok ? ((await listRes.json()) as AccessEntry[]) : entries();
            setEntries(list);
            return list.find((e) => e.id === created.accessId) ?? list[list.length - 1]!;
          }}
          updateAccess={async (_resourceId, accessId, permission) => {
            const res = await apiClient.access[":accessId"].$patch({
              param: { accessId },
              json: { permission },
            });
            if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
            setEntries(entries().map((e) => (e.id === accessId ? { ...e, permission } : e)));
          }}
          revokeAccess={async (_resourceId, accessId) => {
            const res = await apiClient.access[":accessId"].$delete({ param: { accessId } });
            if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
            setEntries(entries().filter((e) => e.id !== accessId));
          }}
        />
      ),
      { title: "Permissions", icon: "ti ti-shield", size: "large" },
    );
    refreshCurrentPath();
  };

  if (!props.canManage) return null;

  return (
    <button type="button" class="btn-simple btn-sm" onClick={open} title="Manage permissions">
      <i class="ti ti-shield" />
    </button>
  );
}
