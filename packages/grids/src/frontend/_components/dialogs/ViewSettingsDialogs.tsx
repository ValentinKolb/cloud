import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  CheckboxCard,
  confirmDiscardIfDirty,
  dialogCore,
  IconInput,
  PanelDialog,
  panelDialogOptions,
  prompts,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { DslQueryPreviewDiagnostic } from "../../../contracts";
import type { Field, View } from "../../../service";
import { createDraft } from "../editor-draft";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { GqlSourceEditor } from "../query/GqlSourceEditor";
import { errorMessage } from "../utils/api-helpers";
import { RecordDisplayConfigEditor } from "./RecordDisplayConfigEditor";

type Props = {
  baseId: string;
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

      <QuerySourceSection
        baseId={props.baseId}
        viewId={props.initialView.id}
        initial={props.initialView}
        onSaved={props.onSaved}
        onDirtyChange={setQueryDirty}
      />

      <PanelDialog.Section title="Permissions" subtitle="Choose who can open this view. Views only support View access." icon="ti ti-lock">
        <ViewPermissions viewId={props.initialView.id} initialEntries={props.initialAccessEntries} canEdit={props.canEditAccess} />
      </PanelDialog.Section>

      <PanelDialog.Section
        title="Danger zone"
        subtitle="Delete this view. Records remain; only this saved view is removed."
        icon="ti ti-trash"
      >
        <DeleteButton
          viewId={props.initialView.id}
          baseShortId={props.baseShortId}
          tableShortId={props.tableShortId}
          name={props.initialView.name}
        />
      </PanelDialog.Section>
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
    <PanelDialog.Section title="General" subtitle="Name and visibility scope." icon="ti ti-id">
      <TextInput label="Name" value={name} onInput={(v) => patch({ name: v })} icon="ti ti-typography" required />
      <IconInput label="Icon" value={icon} onChange={(v) => patch({ icon: v })} placeholder="Search icons..." />
      <RecordDisplayConfigEditor value={displayConfig} onChange={(value) => patch({ displayConfig: value })} fields={() => props.fields} />
      <CheckboxCard
        label="Shared view"
        description={`Visible on ${props.tableName} by default. View permissions below can grant direct access or narrow access.`}
        icon="ti ti-users"
        variant="input"
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
    </PanelDialog.Section>
  );
}

function QuerySourceSection(props: {
  baseId: string;
  viewId: string;
  initial: View;
  onSaved?: (view: View) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  type ValidationState = "idle" | "checking" | "valid" | "invalid" | "error";
  const draft = createDraft({
    source: props.initial.source,
  });
  const [validationState, setValidationState] = createSignal<ValidationState>("idle");
  const [diagnostics, setDiagnostics] = createSignal<DslQueryPreviewDiagnostic[]>([]);
  const [validationError, setValidationError] = createSignal<string | null>(null);
  const source = () => draft.draft().source;
  const patch = (value: string) => {
    draft.patch({ source: value });
    props.onDirtyChange?.(draft.dirty());
  };
  let validationToken = 0;
  let validationAbort: AbortController | undefined;
  createEffect(() => {
    const value = source().trim();
    if (typeof window === "undefined") return;
    validationToken += 1;
    validationAbort?.abort();
    validationAbort = undefined;
    if (!value) {
      setValidationState("invalid");
      setDiagnostics([{ message: "GQL source is required" }]);
      setValidationError(null);
      return;
    }

    const token = validationToken;
    setValidationState("checking");
    const timeout = window.setTimeout(async () => {
      const abort = new AbortController();
      validationAbort = abort;
      try {
        const response = await apiClient.gql["by-base"][":baseId"]["compile-view"].$post(
          {
            param: { baseId: props.baseId },
            json: { query: value, currentTableId: props.initial.tableId, currentSource: { kind: "table", tableId: props.initial.tableId } },
          },
          { init: { signal: abort.signal } },
        );
        if (token !== validationToken || abort.signal.aborted) return;
        if (!response.ok) throw new Error(await errorMessage(response, "Could not validate GQL source"));
        const result = await response.json();
        if (result.ok) {
          setDiagnostics([]);
          setValidationError(null);
          setValidationState("valid");
        } else {
          setDiagnostics(result.diagnostics);
          setValidationError(null);
          setValidationState("invalid");
        }
      } catch (error) {
        if (token !== validationToken || abort.signal.aborted) return;
        setDiagnostics([]);
        setValidationError(error instanceof Error ? error.message : "Could not validate GQL source");
        setValidationState("error");
      }
    }, 300);
    onCleanup(() => window.clearTimeout(timeout));
  });
  onCleanup(() => validationAbort?.abort());

  const mut = mutations.create<View, void>({
    mutation: async () => {
      const trimmed = source().trim();
      if (!trimmed) throw new Error("GQL source is required");
      const compiledResponse = await apiClient.gql["by-base"][":baseId"]["compile-view"].$post({
        param: { baseId: props.baseId },
        json: { query: trimmed, currentTableId: props.initial.tableId, currentSource: { kind: "table", tableId: props.initial.tableId } },
      });
      if (!compiledResponse.ok) throw new Error(await errorMessage(compiledResponse, "Could not validate GQL source"));
      const compiled = await compiledResponse.json();
      if (!compiled.ok) throw new Error(compiled.diagnostics.map(formatDiagnostic).join("; ") || "Invalid GQL source");
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: props.viewId },
        json: { source: compiled.source },
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
    <PanelDialog.Section title="Query" subtitle="The saved GQL source for this view." icon="ti ti-code">
      <label class="text-sm font-medium text-primary" for={`view-source-${props.viewId}`}>
        GQL source
      </label>
      <GqlSourceEditor
        baseId={props.baseId}
        currentSource={{ kind: "table", tableId: props.initial.tableId }}
        id={`view-source-${props.viewId}`}
        name={`view-source-${props.viewId}`}
        value={source}
        onInput={patch}
        lines={8}
        spellcheck={false}
        ariaLabel="GQL source"
        ariaInvalid={validationState() === "invalid" || validationState() === "error"}
        error={validationState() === "invalid" || validationState() === "error"}
        variant="paper"
      />
      <div class="min-h-5 text-xs" aria-live="polite">
        <Show when={validationState() === "checking"}>
          <span class="text-dimmed">
            <i class="ti ti-loader-2 animate-spin" aria-hidden="true" /> Checking GQL source
          </span>
        </Show>
        <Show when={validationState() === "valid"}>
          <span class="text-success">
            <i class="ti ti-check" aria-hidden="true" /> GQL source is valid
          </span>
        </Show>
        <Show when={validationError()}>{(message) => <span class="text-danger">{message()}</span>}</Show>
        <Show when={diagnostics().length > 0}>
          <ul class="grid gap-1 text-danger">
            <For each={diagnostics().slice(0, 4)}>{(diagnostic) => <li>{formatDiagnostic(diagnostic)}</li>}</For>
          </ul>
        </Show>
      </div>
      <Show when={draft.dirty()}>
        <button
          type="button"
          class="btn-primary btn-sm self-start"
          onClick={() => mut.mutate(undefined)}
          disabled={mut.loading() || validationState() !== "valid"}
        >
          {mut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save query"}
        </button>
      </Show>
    </PanelDialog.Section>
  );
}

const formatDiagnostic = (diagnostic: DslQueryPreviewDiagnostic): string =>
  diagnostic.line && diagnostic.column ? `Line ${diagnostic.line}, col ${diagnostic.column}: ${diagnostic.message}` : diagnostic.message;

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
