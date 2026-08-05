import { mutation } from "@k2b/stdlib/solid";
import { Select, toast } from "@k2b/ui";
import { PermissionEditor } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts/shared";
import { createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, RecordScope } from "../../../contracts";
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
  initialEntries: ScopedAccessEntry[];
  canEdit?: boolean;
  allowedLevels?: AllowedLevel[];
  tableId?: string;
};

type ScopedAccessEntry = AccessEntry & { recordScope?: RecordScope };

const supportsRecordScope = (scope: PermissionScope): boolean => scope.type === "base" || scope.type === "table" || scope.type === "view";

const supportsRelatedScope = (scope: PermissionScope): boolean => scope.type === "table" || scope.type === "view";

const entryLabel = (entry: AccessEntry): string => {
  if (entry.displayName) return entry.displayName;
  if (entry.principal.type === "authenticated") return "All users (incl. guests)";
  if (entry.principal.type === "public") return "Public";
  if (entry.principal.type === "user") return entry.principal.userId;
  if (entry.principal.type === "group") return entry.principal.groupId;
  return entry.principal.serviceAccountId;
};

const listAccess = async (scope: PermissionScope): Promise<ScopedAccessEntry[]> => {
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

const relationTableId = async (props: Props): Promise<string | null> => {
  if (props.scope.type === "table") return props.scope.id;
  if (props.scope.type !== "view") return null;
  if (props.tableId) return props.tableId;
  const response = await apiClient.views[":viewId"].$get({ param: { viewId: props.scope.id } });
  if (!response.ok) throw new Error(await errorMessage(response, "Failed to load the view"));
  return (await response.json()).tableId;
};

const RecordScopeRow = (props: {
  entry: ScopedAccessEntry;
  relationFields: Field[];
  canEdit: boolean;
  allowRelated: boolean;
  onSaved: (recordScope: RecordScope) => void;
}) => {
  const initial = props.entry.recordScope ?? ({ kind: "all" } as const);
  let committed = initial;
  const [kind, setKind] = createSignal<RecordScope["kind"]>(initial.kind);
  const [relationFieldId, setRelationFieldId] = createSignal(initial.kind === "related_created_by" ? initial.relationFieldId : null);

  const save = mutation.create<RecordScope, RecordScope>({
    mutation: async (recordScope) => {
      const response = await apiClient.access[":accessId"].$patch({
        param: { accessId: props.entry.id },
        json: { permission: props.entry.permission, recordScope },
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to update record access"));
      return recordScope;
    },
    onSuccess: (recordScope) => {
      committed = recordScope;
      props.onSaved(recordScope);
      toast.success("Record access updated");
    },
    onError: (error) => {
      setKind(committed.kind);
      setRelationFieldId(committed.kind === "related_created_by" ? committed.relationFieldId : null);
      toast.error(error.message);
    },
  });

  const chooseKind = (next: string | null) => {
    if (!next) return;
    const nextKind = next as RecordScope["kind"];
    setKind(nextKind);
    if (nextKind === "related_created_by") {
      const selected = relationFieldId();
      if (selected) save.mutate({ kind: nextKind, relationFieldId: selected });
      return;
    }
    setRelationFieldId(null);
    save.mutate(nextKind === "created_by" ? { kind: "created_by" } : { kind: "all" });
  };

  const chooseRelation = (fieldId: string | null) => {
    setRelationFieldId(fieldId);
    if (fieldId) save.mutate({ kind: "related_created_by", relationFieldId: fieldId });
  };

  return (
    <div class="grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(11rem,15rem)] sm:items-end">
      <div class="min-w-0 pb-1">
        <p class="truncate text-sm font-medium text-default">{entryLabel(props.entry)}</p>
        <p class="text-xs text-dimmed">{props.entry.permission}</p>
      </div>
      <div class="grid gap-2">
        <Show
          when={props.entry.principal.type !== "service_account"}
          fallback={
            <div>
              <p class="text-xs font-medium text-dimmed">Records</p>
              <p class="text-sm text-default">All records</p>
              <p class="text-xs text-dimmed">Service accounts cannot use ownership-based scopes.</p>
            </div>
          }
        >
          <Select
            label="Records"
            value={kind}
            onValueChange={chooseKind}
            disabled={!props.canEdit || save.loading()}
            options={[
              { id: "all", label: "All records" },
              { id: "created_by", label: "Records created by the user" },
              ...(props.allowRelated ? [{ id: "related_created_by", label: "Records linked to the user's record" }] : []),
            ]}
          />
          <Show when={kind() === "related_created_by"}>
            <Select
              label="Relation field"
              placeholder="Choose a relation field"
              value={relationFieldId}
              onValueChange={chooseRelation}
              disabled={!props.canEdit || save.loading()}
              options={props.relationFields.map((field) => ({ id: field.id, label: field.name }))}
            />
            <Show when={props.relationFields.length === 0}>
              <p class="text-xs text-red-600">Create a relation field on this table before using linked ownership.</p>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export function ScopedPermissionEditor(props: Props) {
  const [entries, setEntries] = createSignal<ScopedAccessEntry[]>([...props.initialEntries]);
  const [relationFields, setRelationFields] = createSignal<Field[]>([]);
  const [relationError, setRelationError] = createSignal<string | null>(null);

  onMount(() => {
    if (!supportsRelatedScope(props.scope)) return;
    void relationTableId(props)
      .then(async (tableId) => {
        if (!tableId) return;
        const response = await apiClient.fields["by-table"][":tableId"].$get({ param: { tableId } });
        if (!response.ok) throw new Error(await errorMessage(response, "Failed to load relation fields"));
        const fields = await response.json();
        setRelationFields(fields.filter((field) => field.type === "relation" && !field.deletedAt));
      })
      .catch((error) => setRelationError(error instanceof Error ? error.message : "Failed to load relation fields"));
  });

  return (
    <div class="flex flex-col gap-4">
      <PermissionEditor
        initialEntries={entries()}
        canEdit={props.canEdit}
        allowedLevels={props.allowedLevels}
        grantAccess={async (principal, permission) => {
          const created = await grantAccess(props.scope, principal, permission);
          const refreshed = await listAccess(props.scope);
          setEntries(refreshed);
          return refreshed.find((entry) => entry.id === created.accessId) ?? refreshed[refreshed.length - 1]!;
        }}
        updateAccess={async (accessId, permission) => {
          const res = await apiClient.access[":accessId"].$patch({
            param: { accessId },
            json: { permission },
          });
          if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
          setEntries((current) => current.map((entry) => (entry.id === accessId ? { ...entry, permission } : entry)));
        }}
        revokeAccess={async (accessId) => {
          const res = await apiClient.access[":accessId"].$delete({
            param: { accessId },
          });
          if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
          setEntries((current) => current.filter((entry) => entry.id !== accessId));
        }}
      />
      <Show when={supportsRecordScope(props.scope) && entries().length > 0}>
        <section class="flex flex-col gap-3 border-t border-default pt-4">
          <div>
            <h3 class="text-sm font-semibold text-default">Record access</h3>
            <p class="text-xs text-dimmed">Limit each grant without changing its resource permission.</p>
          </div>
          <Show when={relationError()}>{(message) => <p class="text-xs text-red-600">{message()}</p>}</Show>
          <For each={entries()}>
            {(entry) => (
              <RecordScopeRow
                entry={entry}
                relationFields={relationFields()}
                canEdit={props.canEdit !== false}
                allowRelated={supportsRelatedScope(props.scope)}
                onSaved={(recordScope) =>
                  setEntries((current) =>
                    current.map((candidate) => (candidate.id === entry.id ? { ...candidate, recordScope } : candidate)),
                  )
                }
              />
            )}
          </For>
        </section>
      </Show>
    </div>
  );
}
