import { query } from "@k2b/stdlib/solid";
import { Button, Placeholder, SettingsGroup } from "@k2b/ui";
import { PermissionEditor, type ResourceApiKey, ResourceApiKeys } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { createSignal, Show } from "solid-js";
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
  const apiKeys = query.create({
    source: () => props.notebook.id,
    load: async (notebookId, { abortSignal }): Promise<ResourceApiKey[]> => {
      const response = await apiClient[":id"]["api-keys"].$get({ param: { id: notebookId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load notebook API keys."));
      return ((await response.json()) as { items: ResourceApiKey[] }).items;
    },
  });
  const [reconcileError, setReconcileError] = createSignal<string | null>(null);
  const reconcile = () => {
    setReconcileError(null);
    void apiKeys.invalidate().catch(() => setReconcileError("The change was saved, but the API key list could not be reloaded."));
  };

  return (
    <SettingsGroup title="Integration access" description="Create keys that can access only this notebook.">
      <Show when={!apiKeys.loading()} fallback={<Placeholder state="loading" variant="panel" title="Loading API keys" />}>
        <Show
          when={apiKeys.data()}
          keyed
          fallback={
            <Placeholder
              state="error"
              variant="panel"
              title="Could not load API keys"
              description={apiKeys.error()?.message ?? "The API keys could not be loaded."}
              action={<RetryButton loading={apiKeys.refreshing()} onClick={() => void apiKeys.refresh()} />}
            />
          }
        >
          {(items) => (
            <ResourceApiKeys
              title="API keys"
              description="Resource-bound credentials for integrations. New tokens are shown once."
              initialKeys={items}
              createKey={async (input) => {
                const response = await apiClient[":id"]["api-keys"].$post({
                  param: { id: props.notebook.id },
                  json: input,
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create API key."));
                const created = (await response.json()) as { credential: ResourceApiKey; token: string };
                reconcile();
                return created;
              }}
              revokeKey={async (credentialId) => {
                const response = await apiClient[":id"]["api-keys"][":credentialId"].$delete({
                  param: { id: props.notebook.id, credentialId },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke API key."));
                reconcile();
              }}
            />
          )}
        </Show>
      </Show>
      <Show when={reconcileError()}>
        <div class="flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300">
          <span>{reconcileError()}</span>
          <RetryButton loading={apiKeys.refreshing()} onClick={() => reconcile()} />
        </div>
      </Show>
    </SettingsGroup>
  );
}

export function PermissionsSection(props: { notebook: Notebook }) {
  const accessEntries = query.create({
    source: () => props.notebook.id,
    load: async (notebookId, { abortSignal }): Promise<AccessEntry[]> => {
      const response = await apiClient[":id"].access.$get({ param: { id: notebookId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load notebook permissions."));
      return (await response.json()) as AccessEntry[];
    },
  });
  const [reconcileError, setReconcileError] = createSignal<string | null>(null);
  const reconcile = () => {
    setReconcileError(null);
    void accessEntries.invalidate().catch(() => setReconcileError("The change was saved, but notebook access could not be reloaded."));
  };

  return (
    <SettingsGroup title="People and groups" description="Choose who can read, edit, or administer this notebook.">
      <Show when={!accessEntries.loading()} fallback={<Placeholder state="loading" variant="panel" title="Loading notebook access" />}>
        <Show
          when={accessEntries.data()}
          keyed
          fallback={
            <Placeholder
              state="error"
              variant="panel"
              title="Could not load notebook access"
              description={accessEntries.error()?.message ?? "Notebook access could not be loaded."}
              action={<RetryButton loading={accessEntries.refreshing()} onClick={() => void accessEntries.refresh()} />}
            />
          }
        >
          {(entries) => (
            <PermissionEditor
              initialEntries={entries.filter((entry) => entry.principal.type !== "service_account")}
              canEdit
              grantAccess={async (principal, permission) => {
                const response = await apiClient[":id"].access.$post({
                  param: { id: props.notebook.id },
                  json: { principal, permission },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access."));
                const created = (await response.json()) as AccessEntry;
                reconcile();
                return created;
              }}
              updateAccess={async (accessId, permission) => {
                const response = await apiClient[":id"].access[":accessId"].$patch({
                  param: { id: props.notebook.id, accessId },
                  json: { permission },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access."));
                reconcile();
              }}
              revokeAccess={async (accessId) => {
                const response = await apiClient[":id"].access[":accessId"].$delete({
                  param: { id: props.notebook.id, accessId },
                });
                if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access."));
                reconcile();
              }}
            />
          )}
        </Show>
      </Show>
      <Show when={reconcileError()}>
        <div class="flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300">
          <span>{reconcileError()}</span>
          <RetryButton loading={accessEntries.refreshing()} onClick={() => reconcile()} />
        </div>
      </Show>
    </SettingsGroup>
  );
}
