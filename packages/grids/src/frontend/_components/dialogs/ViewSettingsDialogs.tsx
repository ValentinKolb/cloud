import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  Checkbox,
  confirmDiscardIfDirty,
  dialogCore,
  IconInput,
  panelDialogOptions,
  PanelDialog,
  prompts,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, View } from "../../../service";
import { createDraft } from "../editor-draft";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { errorMessage } from "../utils/api-helpers";
import { SectionCard } from "../utils/SectionCard";
import { RecordDisplayConfigEditor } from "./RecordDisplayConfigEditor";

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
  /** Pre-fetched ACL entries for this view (server-side load). */
  initialAccessEntries: AccessEntry[];
  /** Whether the current user can mutate the view's ACL. */
  canEditAccess: boolean;
  onSaved?: (view: View) => void;
};

export const openViewSettingsDialog = (props: Props) =>
  dialogCore.open<void>((close) => <ViewSettingsDialog props={props} close={close} />, panelDialogOptions);

function ViewSettingsDialog(props: { props: Props; close: () => void }) {
  const [dirty, setDirty] = createSignal(false);
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  return (
    <PanelDialog>
      <PanelDialog.Header title={`View settings — ${props.props.initialView.name}`} icon="ti ti-table-spark" close={closeIfClean} />
      <ViewSettingsBody {...props.props} onDirtyChange={setDirty} />
    </PanelDialog>
  );
}

function ViewSettingsBody(props: Props & { onDirtyChange?: (dirty: boolean) => void }) {
  const [generalDirty, setGeneralDirty] = createSignal(false);
  const [queryDirty, setQueryDirty] = createSignal(false);
  createEffect(() => props.onDirtyChange?.(generalDirty() || queryDirty()));
  return (
    <PanelDialog.Body>
      <GeneralSection
        viewId={props.initialView.id}
        initial={props.initialView}
        tableName={props.tableName}
        fields={props.fields}
        onSaved={props.onSaved}
        onDirtyChange={setGeneralDirty}
      />

      <QuerySourceSection viewId={props.initialView.id} initial={props.initialView} onSaved={props.onSaved} onDirtyChange={setQueryDirty} />

      <SectionCard title="Permissions" subtitle="Choose who can open this view. Views only support View access.">
        <ViewPermissions viewId={props.initialView.id} initialEntries={props.initialAccessEntries} canEdit={props.canEditAccess} />
      </SectionCard>

      <SectionCard title="Danger zone" subtitle="Delete this view. Records remain; only this saved view is removed." variant="danger">
        <DeleteButton
          viewId={props.initialView.id}
          baseShortId={props.baseShortId}
          tableShortId={props.tableShortId}
          name={props.initialView.name}
        />
      </SectionCard>
    </PanelDialog.Body>
  );
}

// =============================================================================
// General — name + shared
// =============================================================================

function GeneralSection(props: {
  viewId: string;
  initial: View;
  tableName: string;
  fields: Field[];
  onSaved?: (view: View) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const draft = createDraft({
    name: props.initial.name,
    icon: props.initial.icon ?? "",
    displayConfig: props.initial.ui.displayConfig ?? { mode: "table" },
    shared: props.initial.ownerUserId === null,
  });
  const patch = (partial: Partial<ReturnType<typeof draft.draft>>) => {
    draft.patch(partial);
    props.onDirtyChange?.(true);
  };
  const name = () => draft.draft().name;
  const icon = () => draft.draft().icon;
  const displayConfig = () => draft.draft().displayConfig;
  const shared = () => draft.draft().shared;

  const mut = mutations.create<View, void>({
    mutation: async () => {
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: props.viewId },
        json: { name: name().trim(), icon: icon() || null, ui: { ...props.initial.ui, displayConfig: displayConfig() }, shared: shared() },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save"));
      return res.json();
    },
    onSuccess: (saved) => {
      draft.markSaved({
        name: saved.name,
        icon: saved.icon ?? "",
        displayConfig: saved.ui.displayConfig ?? { mode: "table" },
        shared: saved.ownerUserId === null,
      });
      props.onDirtyChange?.(false);
      props.onSaved?.(saved);
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <SectionCard title="General" subtitle="Name and visibility scope.">
      <TextInput label="Name" value={name} onInput={(v) => patch({ name: v })} icon="ti ti-typography" required />
      <IconInput label="Icon" value={icon} onChange={(v) => patch({ icon: v })} placeholder="Search icons..." />
      <RecordDisplayConfigEditor value={displayConfig} onChange={(value) => patch({ displayConfig: value })} fields={() => props.fields} />
      <Checkbox
        label="Shared view"
        description={`Visible on ${props.tableName} by default. View permissions below can grant direct access or narrow access.`}
        value={shared}
        onChange={(v) => patch({ shared: v })}
      />
      <Show when={draft.dirty()}>
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

function QuerySourceSection(props: {
  viewId: string;
  initial: View;
  onSaved?: (view: View) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const draft = createDraft({
    source: props.initial.source,
  });
  const source = () => draft.draft().source;
  const patch = (value: string) => {
    draft.patch({ source: value });
    props.onDirtyChange?.(true);
  };
  const mut = mutations.create<View, void>({
    mutation: async () => {
      const trimmed = source().trim();
      if (!trimmed) throw new Error("GQL source is required");
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: props.viewId },
        json: { source: trimmed },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save GQL source"));
      return res.json();
    },
    onSuccess: (saved) => {
      draft.markSaved({ source: saved.source });
      props.onDirtyChange?.(false);
      props.onSaved?.(saved);
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <SectionCard title="Query" subtitle="The saved GQL source for this view.">
      <TextInput
        name={`view-source-${props.viewId}`}
        label="GQL source"
        value={source}
        onInput={patch}
        multiline
        monospace
        lines={8}
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        icon="ti ti-code"
      />
      <Show when={draft.dirty()}>
        <button type="button" class="btn-primary btn-sm self-start" onClick={() => mut.mutate(undefined)} disabled={mut.loading()}>
          {mut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save query"}
        </button>
      </Show>
    </SectionCard>
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

// =============================================================================
// ViewPermissions — wraps the platform PermissionEditor with view-API wires
// =============================================================================
// Views intentionally expose read/admin only. There is no view-write level:
// editing the view definition is an admin action.

function ViewPermissions(props: { viewId: string; initialEntries: AccessEntry[]; canEdit: boolean }) {
  return (
    <ScopedPermissionEditor
      scope={{ type: "view", id: props.viewId }}
      initialEntries={props.initialEntries}
      canEdit={props.canEdit}
      allowedLevels={[
        { level: "read", label: "Read" },
        { level: "admin", label: "Admin" },
      ]}
    />
  );
}
