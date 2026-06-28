import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { Placeholder, prompts, Select, SettingsModal, TextInput } from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Base, Dashboard, Field, Form, Table } from "../../../service";
import { createDraft } from "../editor-draft";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { errorMessage } from "../utils/api-helpers";

type TrashResponse = {
  tables: Table[];
  fields: Field[];
  dashboards: Dashboard[];
  forms: Form[];
};

type Props = {
  base: {
    id: string;
    shortId: string;
    name: string;
    description: string | null;
    defaultDashboardId: string | null;
  };
  accessEntries: AccessEntry[];
  /** Pre-fetched dashboards on this base, used to populate the
   *  default-dashboard select. Empty list disables the select. */
  dashboards: Dashboard[];
  onClose?: () => void;
};

/**
 * Settings page body. The shared SettingsModal shell owns the tabs and
 * section framing; each tab keeps the existing base settings behavior.
 */
export default function BaseSettingsPanel(props: Props) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Base settings"
        subtitle={props.base.name}
        icon="ti ti-table"
        onClose={props.onClose ?? (() => undefined)}
        closeLabel="Close settings"
      >
        <SettingsModal.Tab
          id="general"
          title="General"
          icon="ti ti-id"
          description="Base name and description shown on the grids overview."
        >
          <GeneralForm base={props.base} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="dashboard"
          title="Dashboard"
          icon="ti ti-layout-dashboard"
          description="The dashboard shown when opening this base directly."
        >
          <DefaultDashboardSelect baseId={props.base.id} initial={props.base.defaultDashboardId} dashboards={props.dashboards} />
          {/* Source-permission caveat — dashboards have their own ACL,
            but the data they pull from views/tables is checked at
            render time without an extra cascade. A shared dashboard
            built on a view the grantee can't read directly will still
            show that view's data inline. Surfaced here once so the
            base-admin sees it in context with permission-related
            settings. */}
          <div class="info-block-warning text-xs flex items-start gap-2 mt-3">
            <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
            <span>
              Shared dashboards can surface data from views/tables a viewer can't read directly. Make sure the source views match the
              dashboard's audience.
            </span>
          </div>
        </SettingsModal.Tab>

        <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Base-level grants apply to every table by default.">
          <div class="info-block-info text-xs flex items-start gap-2">
            <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
            <span>
              Override per table from that table's editor: a group with <code class="font-mono">read</code> on the base and{" "}
              <code class="font-mono">write</code> on a single table can edit that table but only read others. Within the same tier, "no
              access" wins; user grants override group grants.
            </span>
          </div>
          <PermissionsSection baseId={props.base.id} initialEntries={props.accessEntries} />
        </SettingsModal.Tab>

        <SettingsModal.Tab id="trash" title="Trash" icon="ti ti-trash" description="Soft-deleted tables, fields, dashboards, and forms.">
          <TrashSection baseId={props.base.id} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="danger"
          title="Danger zone"
          icon="ti ti-alert-triangle"
          description="Permanently delete this base and all of its contents."
          tone="danger"
        >
          <DangerZone baseId={props.base.id} baseName={props.base.name} />
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  );
}

function TrashSection(props: { baseId: string }) {
  // Lazy-load on mount via createResource — trash is base-admin-only
  // and rarely viewed, so we don't bloat the SSR payload with it.
  const [trash, { refetch }] = createResource<TrashResponse>(async () => {
    const res = await apiClient.bases[":baseId"].trash.$get({ param: { baseId: props.baseId } });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to load trash"));
    return res.json();
  });

  const restoreTable = async (id: string) => {
    const res = await apiClient.tables[":tableId"].restore.$post({ param: { tableId: id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to restore table"));
      return;
    }
    refetch();
    refreshCurrentPath();
  };

  const restoreField = async (id: string) => {
    const res = await apiClient.fields[":fieldId"].restore.$post({ param: { fieldId: id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to restore field"));
      return;
    }
    refetch();
  };

  const restoreForm = async (id: string) => {
    const res = await apiClient.forms[":formId"].restore.$post({ param: { formId: id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to restore form"));
      return;
    }
    refetch();
  };

  const restoreDashboard = async (id: string) => {
    const res = await apiClient.dashboards[":dashboardId"].restore.$post({ param: { dashboardId: id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to restore dashboard"));
      return;
    }
    refetch();
    refreshCurrentPath();
  };

  const formatDeletedAt = (iso: string | null) => {
    if (!iso) return "";
    const date = new Date(iso);
    return date.toLocaleDateString();
  };

  return (
    <Show when={!trash.loading} fallback={<p class="text-xs text-dimmed">Loading…</p>}>
      <Show
        when={
          trash() &&
          (trash()!.tables.length > 0 || trash()!.fields.length > 0 || trash()!.dashboards.length > 0 || trash()!.forms.length > 0)
        }
        fallback={
          <Placeholder align="left" class="px-0 py-1">
            Trash is empty.
          </Placeholder>
        }
      >
        <div class="flex flex-col gap-4">
          <Show when={trash()!.tables.length > 0}>
            <div class="flex flex-col gap-1">
              <p class="text-xs font-medium text-secondary">Tables</p>
              <For each={trash()!.tables}>
                {(t) => (
                  <TrashRow icon="ti-table" name={t.name} deletedAt={formatDeletedAt(t.deletedAt)} onRestore={() => restoreTable(t.id)} />
                )}
              </For>
            </div>
          </Show>
          <Show when={trash()!.fields.length > 0}>
            <div class="flex flex-col gap-1">
              <p class="text-xs font-medium text-secondary">Fields</p>
              <For each={trash()!.fields}>
                {(f) => (
                  <TrashRow icon="ti-columns" name={f.name} deletedAt={formatDeletedAt(f.deletedAt)} onRestore={() => restoreField(f.id)} />
                )}
              </For>
            </div>
          </Show>
          <Show when={trash()!.dashboards.length > 0}>
            <div class="flex flex-col gap-1">
              <p class="text-xs font-medium text-secondary">Dashboards</p>
              <For each={trash()!.dashboards}>
                {(dashboard) => (
                  <TrashRow
                    icon="ti-layout-dashboard"
                    name={dashboard.name}
                    deletedAt={formatDeletedAt(dashboard.deletedAt)}
                    onRestore={() => restoreDashboard(dashboard.id)}
                  />
                )}
              </For>
            </div>
          </Show>
          <Show when={trash()!.forms.length > 0}>
            <div class="flex flex-col gap-1">
              <p class="text-xs font-medium text-secondary">Forms</p>
              <For each={trash()!.forms}>
                {(form) => (
                  <TrashRow
                    icon="ti-forms"
                    name={form.name}
                    deletedAt={formatDeletedAt(form.deletedAt)}
                    onRestore={() => restoreForm(form.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  );
}

function TrashRow(props: { icon: string; name: string; deletedAt: string; onRestore: () => void }) {
  return (
    <div class="flex items-center gap-2 py-1.5">
      <i class={`ti ${props.icon} text-dimmed shrink-0`} />
      <span class="flex-1 min-w-0 truncate text-sm">{props.name}</span>
      <Show when={props.deletedAt}>
        <span class="text-[11px] text-dimmed">deleted {props.deletedAt}</span>
      </Show>
      <button type="button" class="btn-simple btn-sm shrink-0" onClick={props.onRestore} title="Restore">
        <i class="ti ti-arrow-back-up" /> Restore
      </button>
    </div>
  );
}

function GeneralForm(props: { base: { id: string; name: string; description: string | null } }) {
  const draft = createDraft({
    name: props.base.name,
    description: props.base.description ?? "",
  });
  const patch = (partial: Partial<ReturnType<typeof draft.draft>>) => {
    draft.patch(partial);
  };
  const name = () => draft.draft().name;
  const description = () => draft.draft().description;

  const mutation = mutations.create<Base, void>({
    mutation: async () => {
      const res = await apiClient.bases[":baseId"].$patch({
        param: { baseId: props.base.id },
        json: { name: name().trim(), description: description().trim() || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save"));
      return res.json();
    },
    onSuccess: (next) => {
      draft.markSaved({
        name: next.name,
        description: next.description ?? "",
      });
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    mutation.mutate(undefined);
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-3">
      <TextInput label="Name" placeholder="My Base" icon="ti ti-typography" value={name} onInput={(v) => patch({ name: v })} required />
      <TextInput
        label="Description"
        placeholder="Optional description..."
        icon="ti ti-align-left"
        value={description}
        onInput={(v) => patch({ description: v })}
        multiline
      />
      <Show when={draft.dirty()}>
        <button type="submit" disabled={mutation.loading()} class="btn-primary btn-sm self-start mt-2">
          {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
        </button>
      </Show>
    </form>
  );
}

/**
 * Default-dashboard select. Saves on change (no separate Save button —
 * the select itself is the affordance, like a setting toggle). Empty
 * dashboards list disables the select with a hint to create one first.
 *
 * The "(none)" option is always present so users can clear the
 * default; that PATCHes `defaultDashboardId: null`.
 */
function DefaultDashboardSelect(props: { baseId: string; initial: string | null; dashboards: Dashboard[] }) {
  const [value, setValue] = createSignal<string>(props.initial ?? "");

  const mutation = mutations.create<void, string | null>({
    mutation: async (next) => {
      const res = await apiClient.bases[":baseId"].$patch({
        param: { baseId: props.baseId },
        json: { defaultDashboardId: next },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update default dashboard"));
    },
    onSuccess: () => {
      // The base record on the page may be stale — refresh so other
      // surfaces that read defaultDashboardId (sidebar badge etc.) update.
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const onChange = (next: string) => {
    setValue(next);
    mutation.mutate(next === "" ? null : next);
  };

  if (props.dashboards.length === 0) {
    return (
      <Placeholder align="left" class="px-0 py-1">
        No dashboards on this base yet. Create one from the records sidebar to enable this setting.
      </Placeholder>
    );
  }

  return (
    <Select
      label="Default dashboard"
      value={value}
      onChange={onChange}
      options={[{ id: "", label: "(none)" }, ...props.dashboards.map((d) => ({ id: d.id, label: d.name }))]}
      icon="ti ti-layout-dashboard"
    />
  );
}

function PermissionsSection(props: { baseId: string; initialEntries: AccessEntry[] }) {
  return <ScopedPermissionEditor scope={{ type: "base", id: props.baseId }} initialEntries={props.initialEntries} canEdit />;
}

function DangerZone(props: { baseId: string; baseName: string }) {
  const deleteMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.bases[":baseId"].$delete({ param: { baseId: props.baseId } });
      // hono-openapi typed client only declares non-204 statuses; check range manually.
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete base"));
    },
    onSuccess: () => navigateTo("/app/grids"),
    onError: (e) => prompts.error(e.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(
      `This permanently deletes "${props.baseName}" and all of its tables, fields, records, and audit history. This cannot be undone.`,
      { title: "Delete base?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMut.mutate(undefined);
  };

  return (
    <button type="button" onClick={handleDelete} disabled={deleteMut.loading()} class="btn-danger btn-sm self-start">
      {deleteMut.loading() ? (
        <i class="ti ti-loader-2 animate-spin" />
      ) : (
        <>
          <i class="ti ti-trash mr-1" />
          Delete base
        </>
      )}
    </button>
  );
}
