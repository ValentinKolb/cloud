import { SettingsGroup } from "@k2b/ui";
import { PermissionEditor, type ResourceApiKey, ResourceApiKeys } from "@valentinkolb/cloud/access/ui";
import { apiClient } from "@/api/client";
import type { AccessEntry } from "@/contracts";
import { readErrorMessage } from "./utils";

export function PermissionsSection(props: { spaceId: string; accessEntries: AccessEntry[]; onWorkspaceChange?: () => void }) {
  return (
    <SettingsGroup title="People and groups" description="Grant read, write, or admin access. Changes save immediately.">
      <PermissionEditor
        initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
        canEdit
        grantAccess={async (principal, permission) => {
          const res = await apiClient[":id"].access.$post({
            param: { id: props.spaceId },
            json: { principal, permission },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to grant access"));
          const entry = await res.json();
          props.onWorkspaceChange?.();
          return entry;
        }}
        updateAccess={async (accessId, permission) => {
          const res = await apiClient[":id"].access[":accessId"].$patch({
            param: { id: props.spaceId, accessId },
            json: { permission },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update permission"));
          props.onWorkspaceChange?.();
        }}
        revokeAccess={async (accessId) => {
          const res = await apiClient[":id"].access[":accessId"].$delete({
            param: { id: props.spaceId, accessId },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke access"));
          props.onWorkspaceChange?.();
        }}
      />
    </SettingsGroup>
  );
}

export function ApiKeysSection(props: { spaceId: string; apiKeys: ResourceApiKey[] }) {
  return (
    <SettingsGroup title="Integration access" description="Create resource-bound credentials for services that need this Space.">
      <ResourceApiKeys
        title="API keys"
        description="Keys inherit access to this Space and can be revoked at any time."
        initialKeys={props.apiKeys}
        createKey={async (input) => {
          const res = await apiClient[":id"]["api-keys"].$post({
            param: { id: props.spaceId },
            json: input,
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create API key."));
          return (await res.json()) as { credential: ResourceApiKey; token: string };
        }}
        revokeKey={async (credentialId) => {
          const res = await apiClient[":id"]["api-keys"][":credentialId"].$delete({
            param: { id: props.spaceId, credentialId },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke API key."));
        }}
      />
    </SettingsGroup>
  );
}
