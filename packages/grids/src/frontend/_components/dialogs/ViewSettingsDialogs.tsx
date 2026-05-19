import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import { Checkbox, dialogCore, IconInput, navigateTo, PermissionEditor, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, View } from "../../service";
import type { ViewQuery } from "../../service/views";
import { errorMessage } from "./api-helpers";
import { GridsBareDialog, gridsBareDialogOptions } from "./dialog-layout";
import { SectionCard } from "./SectionCard";

type Props = {
  baseShortId: string;
  tableShortId: string;
  viewShortId: string;
  /** Display name of the table this view scopes to. Surfaces in the
   *  Shared-toggle's explanation so the user reads concretely *which*
   *  table grants read access ("anyone who can read Books") instead
   *  of an abstract "this table". */
  tableName: string;
  initialView: View;
  fields: Field[];
  /** Pre-fetched ACL entries for this view (server-side load). The
   *  PermissionEditor is given allowedLevels=["read"] because the API
   *  caps view-grants to read/none — write or admin on a view doesn't
   *  exist semantically (you can't "write to a saved query"). */
  initialAccessEntries: AccessEntry[];
  /** Whether the current user can mutate the view's ACL. The API gates
   *  this at table-admin; we mirror it client-side for the UI. */
  canEditAccess: boolean;
};

export const openViewSettingsDialog = (props: Props) =>
  dialogCore.open<void>(
    (close) => (
      <GridsBareDialog title={`View settings — ${props.initialView.name}`} icon="ti ti-table-spark" close={() => close()}>
        <ViewSettingsBody {...props} />
      </GridsBareDialog>
    ),
    gridsBareDialogOptions,
  );

function ViewSettingsBody(props: Props) {
  const isGrouped = (props.initialView.query.groupBy ?? []).length > 0;
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <GeneralSection viewId={props.initialView.id} initial={props.initialView} tableName={props.tableName} />

      <QuerySnapshotSection query={props.initialView.query} fields={props.fields} isGrouped={isGrouped} />

      <SectionCard
        title="Permissions"
        subtitle="Grant read access on this view to specific users or groups. Only Read is offered — views are saved queries; there's no Write or Admin level for them."
      >
        <ViewPermissions viewId={props.initialView.id} initialEntries={props.initialAccessEntries} canEdit={props.canEditAccess} />
      </SectionCard>

      <SectionCard
        title="Danger zone"
        subtitle="Permanently delete this view. Records remain — only the saved filter / sort / columns go away."
        variant="danger"
      >
        <DeleteButton
          viewId={props.initialView.id}
          baseShortId={props.baseShortId}
          tableShortId={props.tableShortId}
          name={props.initialView.name}
        />
      </SectionCard>
    </div>
  );
}

// =============================================================================
// General — name + shared
// =============================================================================

function GeneralSection(props: { viewId: string; initial: View; tableName: string }) {
  const [name, setName] = createSignal(props.initial.name);
  const [icon, setIcon] = createSignal(props.initial.icon ?? "");
  const [shared, setShared] = createSignal(props.initial.ownerUserId === null);
  const [dirty, setDirty] = createSignal(false);

  const wrap =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  const mut = mutations.create<View, void>({
    mutation: async () => {
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: props.viewId },
        json: { name: name().trim(), icon: icon() || null, shared: shared() },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save"));
      return (await res.json()) as View;
    },
    onSuccess: () => setDirty(false),
    onError: (e) => prompts.error(e.message),
  });

  return (
    <SectionCard title="General" subtitle="Name and visibility scope.">
      <TextInput label="Name" value={name} onInput={wrap(setName)} icon="ti ti-typography" required />
      <IconInput label="Icon" value={icon} onChange={wrap(setIcon)} placeholder="Search icons..." />
      <Checkbox
        label="Shared view"
        description={`A shared view is automatically visible to all users with reading permission on the table ${props.tableName}, unless a permission below blocks them. A private view is visible to the owner and to users or groups granted below.`}
        value={shared}
        onChange={wrap(setShared)}
      />
      <Show when={dirty()}>
        <button
          type="button"
          class="btn-primary btn-sm self-start"
          onClick={() => {
            if (!name().trim()) {
              prompts.error("Name is required");
              return;
            }
            mut.mutate(undefined);
          }}
          disabled={mut.loading()}
        >
          {mut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
        </button>
      </Show>
    </SectionCard>
  );
}

function QuerySnapshotSection(props: { query: ViewQuery; fields: Field[]; isGrouped: boolean }) {
  const items = createMemo(() => querySnapshotItems(props.query, props.fields));
  const queryItems = createMemo(() => items().filter((item) => item.group === "query"));
  const structureItems = createMemo(() => items().filter((item) => item.group === "structure"));
  return (
    <SectionCard
      title="Query snapshot"
      subtitle="Saved views keep their current filter, search, sort, grouping, and aggregations as a stable snapshot."
      meta={props.isGrouped ? "Grouped view" : "Record view"}
    >
      <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
        <SnapshotGroup title="Query" items={queryItems()} />
        <SnapshotGroup title="Structure" items={structureItems()} />
      </div>
      <p class="text-[11px] leading-snug text-dimmed">
        This page edits the view name, visibility, and permissions. To change filters, search, sort, grouping, or aggregations, open the
        records page and save the adjusted query as a new view.
      </p>
    </SectionCard>
  );
}

function SnapshotGroup(props: { title: string; items: SnapshotItem[] }) {
  return (
    <div class="min-w-0">
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-secondary">{props.title}</h3>
      <dl class="flex flex-col gap-1.5 text-sm">
        <For each={props.items}>
          {(item) => (
            <div class="flex min-w-0 items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900/40">
              <dt class="flex min-w-[8rem] max-w-[8rem] items-center gap-2 text-secondary">
                <i class={`${item.icon} shrink-0 text-sm text-dimmed`} />
                <span class="truncate">{item.label}</span>
              </dt>
              <dd class="min-w-0 flex-1 truncate font-semibold text-primary" title={item.value}>
                {item.value}
              </dd>
            </div>
          )}
        </For>
      </dl>
    </div>
  );
}

// =============================================================================
// Delete
// =============================================================================

function DeleteButton(props: { viewId: string; baseShortId: string; tableShortId: string; name: string }) {
  const mut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.views[":viewId"].$delete({
        param: { viewId: props.viewId },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete view"));
    },
    onSuccess: () => navigateTo(`/app/grids/${props.baseShortId}/table/${props.tableShortId}`),
    onError: (e) => prompts.error(e.message),
  });

  const handleDelete = async () => {
    const ok = await prompts.confirm(`Delete view "${props.name}"? Records remain — only the saved configuration goes away.`, {
      title: "Delete view?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    mut.mutate(undefined);
  };

  return (
    <button type="button" class="btn-danger btn-sm self-start" onClick={handleDelete} disabled={mut.loading()}>
      <i class="ti ti-trash" /> Delete view
    </button>
  );
}

type SnapshotItem = {
  label: string;
  value: string;
  icon: string;
  group: "query" | "structure";
};

const fieldName = (fieldsById: Map<string, Field>, fieldId: string) => fieldsById.get(fieldId)?.name ?? "Deleted field";

const aggregationName = (fieldsById: Map<string, Field>, agg: { fieldId: string; agg: string; label?: string }) => {
  if (agg.label?.trim()) return agg.label.trim();
  if (agg.fieldId === "*") return `${agg.agg} records`;
  return `${agg.agg} ${fieldName(fieldsById, agg.fieldId)}`;
};

const collectFilterFieldIds = (node: unknown, out = new Set<string>()) => {
  if (!node || typeof node !== "object") return out;
  const obj = node as { fieldId?: unknown; filters?: unknown };
  if (typeof obj.fieldId === "string") out.add(obj.fieldId);
  if (Array.isArray(obj.filters)) {
    for (const child of obj.filters) collectFilterFieldIds(child, out);
  }
  return out;
};

const joinNames = (values: string[], empty: string) => {
  if (values.length === 0) return empty;
  if (values.length <= 3) return values.join(", ");
  return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
};

const querySnapshotItems = (query: ViewQuery, fields: Field[]): SnapshotItem[] => {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const filterFields = [...collectFilterFieldIds(query.filter)].map((id) => fieldName(fieldsById, id));
  const groupBy = query.groupBy ?? [];
  const aggregations = query.aggregations ?? [];
  const sort = query.sort ?? [];
  const columns = query.columns ?? [];

  return [
    {
      label: "Search",
      value: query.search?.q ? `"${query.search.q}"` : "No search",
      icon: "ti ti-search",
      group: "query",
    },
    {
      label: "Filter",
      value: joinNames(filterFields, "No filter"),
      icon: "ti ti-filter",
      group: "query",
    },
    {
      label: "Sort",
      value: joinNames(
        sort.map((s) => `${fieldName(fieldsById, s.fieldId)} ${s.direction}`),
        "No sort",
      ),
      icon: "ti ti-arrows-sort",
      group: "query",
    },
    {
      label: "Group",
      value: joinNames(
        groupBy.map((g) => (g.granularity ? `${fieldName(fieldsById, g.fieldId)} by ${g.granularity}` : fieldName(fieldsById, g.fieldId))),
        "No grouping",
      ),
      icon: "ti ti-hierarchy",
      group: "structure",
    },
    {
      label: "Aggregations",
      value: joinNames(
        aggregations.map((a) => aggregationName(fieldsById, a)),
        "No aggregations",
      ),
      icon: "ti ti-math-function",
      group: "structure",
    },
    {
      label: "Columns",
      value: columns.length > 0 ? `${columns.length} custom` : groupBy.length > 0 ? "Generated" : "Table default",
      icon: "ti ti-layout-columns",
      group: "structure",
    },
  ];
};

// =============================================================================
// ViewPermissions — wraps the platform PermissionEditor with view-API wires
// =============================================================================
// Mirrors the table permissions editor. The only difference: we pass
// `allowedLevels={["read"]}` so the editor renders as plain inline badges
// (no SegmentedControl, no chevron dropdown) — there's no Write or Admin
// for a view, the API caps every grant at "read" or "none".

function ViewPermissions(props: { viewId: string; initialEntries: AccessEntry[]; canEdit: boolean }) {
  const [entries, setEntries] = createSignal<AccessEntry[]>(props.initialEntries);
  return (
    <PermissionEditor
      initialEntries={entries()}
      canEdit={props.canEdit}
      allowedLevels={[{ level: "read", label: "View" }]}
      grantAccess={async (principal, permission) => {
        const res = await apiClient.access["by-view"][":viewId"].$post({
          param: { viewId: props.viewId },
          json: { principal, permission },
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
        const created = (await res.json()) as { accessId: string };
        // Refetch the canonical list so the new entry has displayName etc.
        const listRes = await apiClient.access["by-view"][":viewId"].$get({
          param: { viewId: props.viewId },
        });
        const list = listRes.ok ? ((await listRes.json()) as AccessEntry[]) : entries();
        setEntries(list);
        return list.find((e) => e.id === created.accessId) ?? list[list.length - 1]!;
      }}
      updateAccess={async (accessId, permission) => {
        const res = await apiClient.access[":accessId"].$patch({
          param: { accessId },
          json: { permission },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
        setEntries(entries().map((e) => (e.id === accessId ? { ...e, permission } : e)));
      }}
      revokeAccess={async (accessId) => {
        const res = await apiClient.access[":accessId"].$delete({ param: { accessId } });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
        setEntries(entries().filter((e) => e.id !== accessId));
      }}
    />
  );
}
