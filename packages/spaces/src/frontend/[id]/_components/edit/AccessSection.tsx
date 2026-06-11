import { PermissionEditor, type ResourceApiKey, ResourceApiKeys } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { AccessEntry } from "@/contracts";
import { readErrorMessage } from "./utils";

export function AccessSection(props: { spaceId: string; accessEntries: AccessEntry[]; apiKeys: ResourceApiKey[] }) {
  return (
    <div class="flex flex-col gap-6">
      <PermissionEditor
        initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
        canEdit
        grantAccess={async (principal, permission) => {
          const res = await apiClient[":id"].access.$post({
            param: { id: props.spaceId },
            json: { principal, permission },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to grant access"));
          return res.json();
        }}
        updateAccess={async (accessId, permission) => {
          const res = await apiClient[":id"].access[":accessId"].$patch({
            param: { id: props.spaceId, accessId },
            json: { permission },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update permission"));
        }}
        revokeAccess={async (accessId) => {
          const res = await apiClient[":id"].access[":accessId"].$delete({
            param: { id: props.spaceId, accessId },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke access"));
        }}
      />
      <ResourceApiKeys
        title="API keys"
        description="Resource-bound keys for integrations that need access to this space."
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
    </div>
  );
}
