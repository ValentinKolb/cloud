import { Button, NoticeCard, Placeholder } from "@k2b/ui";
import { PermissionEditor } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts/shared";
import { createSignal, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { errorMessage } from "../utils/api-helpers";

type GrantableLevel = Exclude<PermissionLevel, "none">;
type AllowedLevel = GrantableLevel | { level: GrantableLevel; label?: string; icon?: string };

type PermissionScope = { type: "base"; id: string } | { type: "customApp"; id: string };

type Props = {
  scope: PermissionScope;
  initialEntries?: AccessEntry[];
  canEdit?: boolean;
  allowedLevels?: AllowedLevel[];
};

const listAccess = async (scope: PermissionScope): Promise<AccessEntry[]> => {
  const response =
    scope.type === "base"
      ? await apiClient.access["by-base"][":baseId"].$get({ param: { baseId: scope.id } })
      : await apiClient.access["by-custom-app"][":customAppId"].$get({ param: { customAppId: scope.id } });
  if (!response.ok) throw new Error(await errorMessage(response, "Failed to refresh access"));
  return response.json();
};

const grantAccess = async (scope: PermissionScope, principal: Principal, permission: GrantableLevel) => {
  const response =
    scope.type === "base"
      ? await apiClient.access["by-base"][":baseId"].$post({ param: { baseId: scope.id }, json: { principal, permission } })
      : await apiClient.access["by-custom-app"][":customAppId"].$post({
          param: { customAppId: scope.id },
          json: { principal, permission },
        });
  if (!response.ok) throw new Error(await errorMessage(response, "Failed to grant access"));
  return response.json();
};

export function ScopedPermissionEditor(props: Props) {
  const [entries, setEntries] = createSignal<AccessEntry[] | null>(props.initialEntries ? [...props.initialEntries] : null);
  const [loading, setLoading] = createSignal(props.initialEntries === undefined);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEntries(await listAccess(props.scope));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load access");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    if (props.initialEntries === undefined) void load();
  });

  return (
    <Show
      when={entries()}
      fallback={
        <Show when={!loading() && loadError()} fallback={<Placeholder state="loading" align="left" title="Loading access…" />}>
          {(message) => (
            <NoticeCard tone="danger" icon={false} bodyClass="flex items-center justify-between gap-3">
              <span>{message()}</span>
              <Button variant="secondary" size="sm" type="button" onClick={() => void load()}>
                <i class="ti ti-refresh" /> Retry
              </Button>
            </NoticeCard>
          )}
        </Show>
      }
    >
      {(loadedEntries) => (
        <PermissionEditor
          initialEntries={loadedEntries()}
          canEdit={props.canEdit}
          allowPublic={props.scope.type === "customApp"}
          allowedLevels={props.scope.type === "customApp" ? [{ level: "read", label: "Open", icon: "ti ti-eye" }] : props.allowedLevels}
          grantAccess={async (principal, permission) => {
            const created = await grantAccess(props.scope, principal, permission);
            const refreshed = await listAccess(props.scope);
            setEntries(refreshed);
            return refreshed.find((entry) => entry.id === created.accessId) ?? refreshed[refreshed.length - 1]!;
          }}
          updateAccess={async (accessId, permission) => {
            const response = await apiClient.access[":accessId"].$patch({
              param: { accessId },
              json: { permission },
            });
            if (!response.ok) throw new Error(await errorMessage(response, "Failed to update access"));
            setEntries((current) => current?.map((entry) => (entry.id === accessId ? { ...entry, permission } : entry)) ?? null);
          }}
          revokeAccess={async (accessId) => {
            const response = await apiClient.access[":accessId"].$delete({ param: { accessId } });
            if (!response.ok) throw new Error(await errorMessage(response, "Failed to revoke access"));
            setEntries((current) => current?.filter((entry) => entry.id !== accessId) ?? null);
          }}
        />
      )}
    </Show>
  );
}
