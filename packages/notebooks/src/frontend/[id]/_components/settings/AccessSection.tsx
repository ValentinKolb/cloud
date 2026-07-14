import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { PermissionEditor, type ResourceApiKey, ResourceApiKeys } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Notebook } from "../sidebar/types";
import { readErrorMessage } from "./utils";

function ApiKeysSection(props: { notebook: Notebook; apiKeys: ResourceApiKey[]; isAdmin: boolean }) {
  return (
    <Show when={props.isAdmin} fallback={<p class="text-xs text-dimmed">Only notebook admins can manage API keys.</p>}>
      <ResourceApiKeys
        title="API keys"
        description="Resource-bound keys for integrations that need access to this notebook."
        initialKeys={props.apiKeys}
        createKey={async (input) => {
          const res = await apiClient[":id"]["api-keys"].$post({
            param: { id: props.notebook.shortId },
            json: input,
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create API key."));
          return (await res.json()) as { credential: ResourceApiKey; token: string };
        }}
        revokeKey={async (credentialId) => {
          const res = await apiClient[":id"]["api-keys"][":credentialId"].$delete({
            param: { id: props.notebook.shortId, credentialId },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke API key."));
        }}
      />
    </Show>
  );
}

function PermissionsSection(props: { notebook: Notebook; accessEntries: AccessEntry[]; isAdmin: boolean }) {
  return (
    <Show when={props.isAdmin} fallback={<p class="text-xs text-dimmed">Only notebook admins can manage access.</p>}>
      <PermissionEditor
        initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
        canEdit
        grantAccess={async (principal, permission) => {
          const res = await apiClient[":id"].access.$post({
            param: { id: props.notebook.shortId },
            json: { principal, permission },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to grant access."));
          return (await res.json()) as AccessEntry;
        }}
        updateAccess={async (accessId, permission) => {
          const res = await apiClient[":id"].access[":accessId"].$patch({
            param: { id: props.notebook.shortId, accessId },
            json: { permission },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update access."));
        }}
        revokeAccess={async (accessId) => {
          const res = await apiClient[":id"].access[":accessId"].$delete({
            param: { id: props.notebook.shortId, accessId },
          });
          if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke access."));
        }}
      />
    </Show>
  );
}

export function AccessSection(props: { notebook: Notebook; accessEntries: AccessEntry[]; apiKeys: ResourceApiKey[]; isAdmin: boolean }) {
  return (
    <div class="flex flex-col gap-2">
      <PermissionsSection notebook={props.notebook} accessEntries={props.accessEntries} isAdmin={props.isAdmin} />
      <ApiKeysSection notebook={props.notebook} apiKeys={props.apiKeys} isAdmin={props.isAdmin} />
    </div>
  );
}
