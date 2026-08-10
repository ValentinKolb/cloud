import { Button, Placeholder, SettingsGroup } from "@k2b/ui";
import { PermissionEditor, type ResourceApiKey, ResourceApiKeys } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { createResource, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Notebook } from "../sidebar/types";
import { readErrorMessage } from "./utils";

function RetryButton(props: { loading: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" size="sm" disabled={props.loading} onClick={props.onClick}>
      <i class={props.loading ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} aria-hidden="true" />
      Retry
    </Button>
  );
}

export function ApiKeysSection(props: { notebook: Notebook }) {
  const [apiKeys, { refetch }] = createResource(async (): Promise<ResourceApiKey[]> => {
    const response = await apiClient[":id"]["api-keys"].$get({ param: { id: props.notebook.shortId } });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load notebook API keys."));
    return ((await response.json()) as { items: ResourceApiKey[] }).items;
  });

  return (
    <SettingsGroup title="Integration access" description="Create keys that can access only this notebook.">
      <Show when={!apiKeys.loading} fallback={<Placeholder state="loading" variant="panel" title="Loading API keys" />}>
        <Show
          when={apiKeys()}
          fallback={
            <Placeholder
              state="error"
              variant="panel"
              title="Could not load API keys"
              description={apiKeys.error instanceof Error ? apiKeys.error.message : "The API keys could not be loaded."}
              action={<RetryButton loading={apiKeys.loading} onClick={() => void refetch()} />}
            />
          }
        >
          {(items) => (
            <ResourceApiKeys
              title="API keys"
              description="Resource-bound credentials for integrations. New tokens are shown once."
              initialKeys={items()}
              createKey={async (input) => {
                const response = await apiClient[":id"]["api-keys"].$post({
                  param: { id: props.notebook.shortId },
                  json: input,
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create API key."));
                return (await response.json()) as { credential: ResourceApiKey; token: string };
              }}
              revokeKey={async (credentialId) => {
                const response = await apiClient[":id"]["api-keys"][":credentialId"].$delete({
                  param: { id: props.notebook.shortId, credentialId },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke API key."));
              }}
            />
          )}
        </Show>
      </Show>
    </SettingsGroup>
  );
}

export function PermissionsSection(props: { notebook: Notebook }) {
  const [accessEntries, { refetch }] = createResource(async (): Promise<AccessEntry[]> => {
    const response = await apiClient[":id"].access.$get({ param: { id: props.notebook.shortId } });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load notebook permissions."));
    return (await response.json()) as AccessEntry[];
  });

  return (
    <SettingsGroup title="People and groups" description="Choose who can read, edit, or administer this notebook.">
      <Show when={!accessEntries.loading} fallback={<Placeholder state="loading" variant="panel" title="Loading notebook access" />}>
        <Show
          when={accessEntries()}
          fallback={
            <Placeholder
              state="error"
              variant="panel"
              title="Could not load notebook access"
              description={accessEntries.error instanceof Error ? accessEntries.error.message : "Notebook access could not be loaded."}
              action={<RetryButton loading={accessEntries.loading} onClick={() => void refetch()} />}
            />
          }
        >
          {(entries) => (
            <PermissionEditor
              initialEntries={entries().filter((entry) => entry.principal.type !== "service_account")}
              canEdit
              grantAccess={async (principal, permission) => {
                const response = await apiClient[":id"].access.$post({
                  param: { id: props.notebook.shortId },
                  json: { principal, permission },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access."));
                return (await response.json()) as AccessEntry;
              }}
              updateAccess={async (accessId, permission) => {
                const response = await apiClient[":id"].access[":accessId"].$patch({
                  param: { id: props.notebook.shortId, accessId },
                  json: { permission },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access."));
              }}
              revokeAccess={async (accessId) => {
                const response = await apiClient[":id"].access[":accessId"].$delete({
                  param: { id: props.notebook.shortId, accessId },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access."));
              }}
            />
          )}
        </Show>
      </Show>
    </SettingsGroup>
  );
}
