import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts/shared";
import { PermissionEditor } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import { errorMessage } from "../utils/api-helpers";

type GrantableLevel = Exclude<PermissionLevel, "none">;
type AllowedLevel = GrantableLevel | { level: GrantableLevel; label?: string; icon?: string };

type PermissionScope =
  | { type: "base"; id: string }
  | { type: "table"; id: string }
  | { type: "view"; id: string }
  | { type: "form"; id: string }
  | { type: "documentTemplate"; id: string }
  | { type: "dashboard"; id: string };

type Props = {
  scope: PermissionScope;
  initialEntries: AccessEntry[];
  canEdit?: boolean;
  allowedLevels?: AllowedLevel[];
};

const listAccess = async (scope: PermissionScope): Promise<AccessEntry[]> => {
  const res =
    scope.type === "base"
      ? await apiClient.access["by-base"][":baseId"].$get({ param: { baseId: scope.id } })
      : scope.type === "table"
        ? await apiClient.access["by-table"][":tableId"].$get({ param: { tableId: scope.id } })
        : scope.type === "view"
          ? await apiClient.access["by-view"][":viewId"].$get({ param: { viewId: scope.id } })
          : scope.type === "form"
            ? await apiClient.access["by-form"][":formId"].$get({ param: { formId: scope.id } })
            : scope.type === "documentTemplate"
              ? await apiClient.access["by-document-template"][":templateId"].$get({ param: { templateId: scope.id } })
              : await apiClient.access["by-dashboard"][":dashboardId"].$get({ param: { dashboardId: scope.id } });
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to refresh access"));
  return res.json();
};

const grantAccess = async (scope: PermissionScope, principal: Principal, permission: GrantableLevel) => {
  const res =
    scope.type === "base"
      ? await apiClient.access["by-base"][":baseId"].$post({ param: { baseId: scope.id }, json: { principal, permission } })
      : scope.type === "table"
        ? await apiClient.access["by-table"][":tableId"].$post({ param: { tableId: scope.id }, json: { principal, permission } })
        : scope.type === "view"
          ? await apiClient.access["by-view"][":viewId"].$post({ param: { viewId: scope.id }, json: { principal, permission } })
          : scope.type === "form"
            ? await apiClient.access["by-form"][":formId"].$post({ param: { formId: scope.id }, json: { principal, permission } })
            : scope.type === "documentTemplate"
              ? await apiClient.access["by-document-template"][":templateId"].$post({
                  param: { templateId: scope.id },
                  json: { principal, permission },
                })
              : await apiClient.access["by-dashboard"][":dashboardId"].$post({
                  param: { dashboardId: scope.id },
                  json: { principal, permission },
                });
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
  return res.json();
};

export function ScopedPermissionEditor(props: Props) {
  return (
    <PermissionEditor
      initialEntries={props.initialEntries}
      canEdit={props.canEdit}
      allowedLevels={props.allowedLevels}
      grantAccess={async (principal, permission) => {
        const created = await grantAccess(props.scope, principal, permission);
        const entries = await listAccess(props.scope);
        return entries.find((entry) => entry.id === created.accessId) ?? entries[entries.length - 1]!;
      }}
      updateAccess={async (accessId, permission) => {
        const res = await apiClient.access[":accessId"].$patch({
          param: { accessId },
          json: { permission },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
      }}
      revokeAccess={async (accessId) => {
        const res = await apiClient.access[":accessId"].$delete({
          param: { accessId },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
      }}
    />
  );
}
