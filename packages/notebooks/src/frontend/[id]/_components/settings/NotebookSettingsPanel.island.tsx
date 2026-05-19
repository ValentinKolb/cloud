import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import {
  Checkbox,
  IconInput,
  navigateTo,
  PermissionEditor,
  prompts,
  SelectInput,
  SettingsModal,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Notebook, NoteTreeNode } from "../sidebar/types";

type Props = {
  notebook: Notebook;
  tree: NoteTreeNode[];
  accessEntries: AccessEntry[];
  isAdmin: boolean;
  canWrite: boolean;
};

type NoteSelectOption = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
};

const flattenNoteOptions = (nodes: NoteTreeNode[], depth = 0): NoteSelectOption[] =>
  nodes.flatMap((note) => [
    {
      id: note.shortId,
      label: `${"\u00A0\u00A0".repeat(depth)}${note.title || "Untitled"}`,
      description: `#${note.shortId}`,
      icon: note.lockedAt ? "ti ti-lock" : "ti ti-file-text",
    },
    ...flattenNoteOptions(note.children, depth + 1),
  ]);

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data?.message === "string" && data.message.length > 0) return data.message;
  } catch {
    // Keep the caller-provided fallback.
  }
  return fallback;
};

export const openNotebookSettingsDialog = (props: Props): Promise<void> =>
  prompts.dialog<void>(
    (close) => <NotebookSettingsBody {...props} bare close={() => close()} />,
    { surface: "bare", header: false, size: "large" },
  );

function LocalSaveStrip(props: {
  dirty: boolean;
  loading: boolean;
  label?: string;
  onSave: () => void;
}) {
  return (
    <Show
      when={props.dirty}
      fallback={
        <p class="flex items-center gap-1.5 text-xs text-dimmed">
          <i class="ti ti-check text-emerald-500" />
          Saved
        </p>
      }
    >
      <div class="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
        <span class="flex items-center gap-1.5">
          <i class="ti ti-pencil" />
          Unsaved changes
        </span>
        <button type="button" class="btn-primary btn-sm ml-auto" disabled={props.loading} onClick={props.onSave}>
          {props.loading ? (
            <>
              <i class="ti ti-loader-2 animate-spin" />
              Saving
            </>
          ) : (
            props.label ?? "Save"
          )}
        </button>
      </div>
    </Show>
  );
}

function SaveStatus(props: { loading: boolean; saved: boolean; error?: string | null }) {
  if (props.loading) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-dimmed">
        <i class="ti ti-loader-2 animate-spin" />
        Saving...
      </span>
    );
  }
  if (props.error) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
        <i class="ti ti-alert-circle" />
        Failed
      </span>
    );
  }
  if (props.saved) {
    return (
      <span class="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <i class="ti ti-check" />
        Saved
      </span>
    );
  }
  return null;
}

// =============================================================================
// General
// =============================================================================

function GeneralSection(props: { notebook: Notebook; tree: NoteTreeNode[]; canWrite: boolean; onNotebookChange: (notebook: Notebook) => void }) {
  const options = createMemo(() => flattenNoteOptions(props.tree));
  const [base, setBase] = createSignal({
    name: props.notebook.name,
    description: props.notebook.description ?? "",
    icon: props.notebook.icon ?? "",
    homepageNoteId: props.notebook.homepageNoteShortId ?? "",
  });
  const [name, setName] = createSignal(base().name);
  const [description, setDescription] = createSignal(base().description);
  const [icon, setIcon] = createSignal(base().icon);
  const [homepageNoteId, setHomepageNoteId] = createSignal(base().homepageNoteId);

  const selectedLabel = () => options().find((option) => option.id === homepageNoteId())?.label;
  const dirty = () =>
    name() !== base().name ||
    description() !== base().description ||
    icon() !== base().icon ||
    homepageNoteId() !== base().homepageNoteId;

  const fetchNotes = async (query: string, signal: AbortSignal): Promise<NoteSelectOption[]> => {
    if (signal.aborted) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options().filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(q))
      : options();
    return filtered.slice(0, 50);
  };

  const mutation = mutations.create({
    mutation: async () => {
      if (!name().trim()) throw new Error("Name is required");
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: {
          name: name().trim(),
          description: description().trim() || null,
          icon: icon().trim() || null,
          homepageNoteId: homepageNoteId() || null,
        },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update notebook."));
      return (await res.json()) as Notebook;
    },
    onSuccess: (next) => {
      setBase({
        name: next.name,
        description: next.description ?? "",
        icon: next.icon ?? "",
        homepageNoteId: next.homepageNoteShortId ?? "",
      });
      props.onNotebookChange(next);
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Name"
          description="Shown in the sidebar and overview."
          value={name}
          onInput={setName}
          icon="ti ti-notebook"
          required
          disabled={!props.canWrite}
        />
        <IconInput
          label="Icon"
          description="Used in the sidebar header."
          value={icon}
          onChange={setIcon}
          placeholder="Search icons..."
          disabled={!props.canWrite}
        />
      </div>

      <TextInput
        label="Description"
        description="Optional short note for the overview."
        value={description}
        onInput={setDescription}
        multiline
        lines={2}
        placeholder="What is this notebook for?"
        icon="ti ti-align-left"
        disabled={!props.canWrite}
      />

      <SelectInput
        label="Homepage"
        description="Opened when this notebook has no URL note and no valid last active note."
        value={homepageNoteId}
        onChange={setHomepageNoteId}
        selectedLabel={selectedLabel}
        fetchData={fetchNotes}
        placeholder="Select a note..."
        icon="ti ti-home"
        activeIcon="ti ti-search"
        clearable
        disabled={!props.canWrite}
      />

      <Show
        when={props.canWrite}
        fallback={<p class="text-xs text-dimmed">You can view this notebook, but only editors can change identity settings.</p>}
      >
        <LocalSaveStrip dirty={dirty()} loading={mutation.loading()} onSave={() => mutation.mutate(undefined)} />
      </Show>
    </div>
  );
}

// =============================================================================
// Features
// =============================================================================

function FeaturesSection(props: { notebook: Notebook; isAdmin: boolean; onNotebookChange: (notebook: Notebook) => void }) {
  const [enabled, setEnabled] = createSignal(props.notebook.scriptsEnabled);
  const [saved, setSaved] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const mutation = mutations.create<Notebook, boolean>({
    mutation: async (next) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: { scriptsEnabled: next },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update scripting setting."));
      return (await res.json()) as Notebook;
    },
    onSuccess: (next) => {
      setEnabled(next.scriptsEnabled);
      setSaved(true);
      setError(null);
      props.onNotebookChange(next);
    },
    onError: (err) => {
      setEnabled(props.notebook.scriptsEnabled);
      setSaved(false);
      setError(err.message);
      prompts.error(err.message);
    },
  });

  const setScriptsEnabled = async (next: boolean) => {
    if (next && !enabled()) {
      const confirmed = await prompts.confirm(
        `Scripts in this notebook can read your notes, modify content, and call browser APIs on your behalf.\n\nEnable scripting in "${props.notebook.name}"?`,
        {
          title: "Enable scripting",
          icon: "ti ti-alert-triangle",
          variant: "danger",
          confirmText: "Enable",
        },
      );
      if (!confirmed) return;
    }
    setEnabled(next);
    setSaved(false);
    setError(null);
    mutation.mutate(next);
  };

  return (
    <div class="flex flex-col gap-3">
      <Checkbox
        label="Enable script blocks"
        description="Allows ```script fences to run JavaScript in this notebook. Admin only."
        value={enabled}
        onChange={setScriptsEnabled}
        disabled={!props.isAdmin || mutation.loading()}
      />
      <SaveStatus loading={mutation.loading()} saved={saved()} error={error()} />
    </div>
  );
}

// =============================================================================
// Permissions
// =============================================================================

function PermissionsSection(props: { notebook: Notebook; accessEntries: AccessEntry[]; isAdmin: boolean }) {
  return (
    <Show
      when={props.isAdmin}
      fallback={<p class="text-xs text-dimmed">Only notebook admins can manage access.</p>}
    >
      <PermissionEditor
        initialEntries={props.accessEntries}
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

// =============================================================================
// Danger Zone
// =============================================================================

function DangerZone(props: { notebook: Notebook }) {
  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient[":id"].$delete({
        param: { id: props.notebook.shortId },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete notebook."));
    },
    onSuccess: () => navigateTo("/app/notebooks"),
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Delete "${props.notebook.name}" and all its notes? This cannot be undone.`, {
      title: "Delete notebook",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (confirmed) mutation.mutate(undefined);
  };

  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-dimmed">This removes notes, versions, attachments, and access grants. It cannot be undone.</p>
      <button type="button" onClick={handleDelete} disabled={mutation.loading()} class="btn-danger btn-md self-start">
        {mutation.loading() ? (
          <>
            <i class="ti ti-loader-2 animate-spin" />
            Deleting
          </>
        ) : (
          <>
            <i class="ti ti-trash" />
            Delete notebook
          </>
        )}
      </button>
    </div>
  );
}

// =============================================================================
// Shared Body
// =============================================================================

function NotebookSettingsBody(props: Props & { bare?: boolean; close?: () => void }) {
  const [notebook, setNotebook] = createSignal(props.notebook);

  return (
    <div class={props.bare ? "flex h-[86vh] min-h-0 flex-col overflow-hidden" : "flex-1 overflow-y-auto"}>
      <div class={props.bare ? "min-h-0 flex-1 overflow-hidden" : "mx-auto flex h-full min-h-[70vh] max-w-5xl flex-col px-4 py-6"}>
        <SettingsModal
          title="Notebook settings"
          subtitle={notebook().name}
          icon={notebook().icon || "ti-notebook"}
          onClose={props.close}
          closeLabel="Close settings"
        >
          <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, icon, description, and default start page.">
            <GeneralSection notebook={notebook()} tree={props.tree} canWrite={props.canWrite} onNotebookChange={setNotebook} />
          </SettingsModal.Tab>
          {props.isAdmin && (
            <>
              <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
                <PermissionsSection notebook={notebook()} accessEntries={props.accessEntries} isAdmin={props.isAdmin} />
              </SettingsModal.Tab>
              <SettingsModal.Tab id="features" title="Features" icon="ti ti-toggle-right" description="Notebook-level behavior that saves immediately.">
                <FeaturesSection notebook={notebook()} isAdmin={props.isAdmin} onNotebookChange={setNotebook} />
              </SettingsModal.Tab>
              <SettingsModal.Tab
                id="danger"
                title="Danger zone"
                icon="ti ti-alert-triangle"
                description="Permanently delete this notebook and all of its notes."
                tone="danger"
              >
                <DangerZone notebook={notebook()} />
              </SettingsModal.Tab>
            </>
          )}
        </SettingsModal>
      </div>
    </div>
  );
}

export default function NotebookSettingsPanel(props: Props) {
  return <NotebookSettingsBody {...props} />;
}
