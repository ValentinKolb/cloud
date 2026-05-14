import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { IconInput, navigateTo, PermissionEditor, prompts, refreshCurrentPath, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal } from "solid-js";
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

// =============================================================================
// General Settings
// =============================================================================

function GeneralSection(props: { notebook: Notebook }) {
  const [name, setName] = createSignal(props.notebook.name);
  const [description, setDescription] = createSignal(props.notebook.description ?? "");
  const [icon, setIcon] = createSignal(props.notebook.icon ?? "");

  const mutation = mutations.create({
    mutation: async (data: { name?: string; description?: string | null; icon?: string | null }) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: data,
      });
      if (!res.ok) throw new Error("Failed to update notebook");
      return res.json();
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleSave = () => {
    mutation.mutate({
      name: name(),
      description: description() || null,
      icon: icon() || null,
    });
  };

  const hasChanges = () =>
    name() !== props.notebook.name ||
    (description() || null) !== (props.notebook.description ?? null) ||
    (icon() || null) !== (props.notebook.icon ?? null);

  return (
    <div class="flex flex-col gap-4">
      <h3 class="section-label mb-0 flex items-center gap-2">
        <i class="ti ti-settings text-dimmed" />
        General
      </h3>

      <TextInput label="Name" value={() => name()} onChange={setName} required placeholder="Notebook name" icon="ti ti-notebook" />

      <TextInput
        label="Description"
        value={() => description()}
        onChange={setDescription}
        multiline
        placeholder="Optional description"
        icon="ti ti-align-left"
      />

      <IconInput
        label="Icon"
        value={() => icon()}
        onChange={setIcon}
        placeholder="Search icons…"
      />

      <button type="button" onClick={handleSave} disabled={mutation.loading() || !hasChanges()} class="btn-primary btn-md self-start">
        {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
      </button>
    </div>
  );
}

// =============================================================================
// Homepage
// =============================================================================

function HomepageSection(props: { notebook: Notebook; tree: NoteTreeNode[] }) {
  const options = createMemo(() => flattenNoteOptions(props.tree));
  const initialValue = props.notebook.homepageNoteShortId ?? "";
  const [homepageNoteId, setHomepageNoteId] = createSignal(initialValue);

  const selectedLabel = () => options().find((option) => option.id === homepageNoteId())?.label;
  const hasChanges = () => homepageNoteId() !== initialValue;

  const mutation = mutations.create({
    mutation: async (value: string) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: { homepageNoteId: value || null },
      });
      if (!res.ok) throw new Error("Failed to update homepage note");
      return res.json();
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const fetchNotes = async (query: string, signal: AbortSignal): Promise<NoteSelectOption[]> => {
    if (signal.aborted) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options().filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(q))
      : options();
    return filtered.slice(0, 50);
  };

  return (
    <div class="flex flex-col gap-4">
      <h3 class="section-label mb-0 flex items-center gap-2">
        <i class="ti ti-home text-dimmed" />
        Homepage
      </h3>
      <SelectInput
        label="Homepage note"
        description="Opened when this notebook has no URL note and no valid last active note."
        value={() => homepageNoteId()}
        onChange={setHomepageNoteId}
        selectedLabel={selectedLabel}
        fetchData={fetchNotes}
        placeholder="Select a note..."
        icon="ti ti-home"
        activeIcon="ti ti-search"
        clearable
      />
      <button
        type="button"
        onClick={() => mutation.mutate(homepageNoteId())}
        disabled={mutation.loading() || !hasChanges()}
        class="btn-primary btn-md self-start"
      >
        {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save homepage"}
      </button>
    </div>
  );
}

// =============================================================================
// Scripting (admin-only) — toggles the per-notebook opt-in for
// `\`\`\`script` block execution. Off by default. Toggling triggers a
// PATCH /:id with `scriptsEnabled` which the API gates to admin only.
// =============================================================================

function ScriptingSection(props: { notebook: Notebook }) {
  const [enabled, setEnabled] = createSignal(props.notebook.scriptsEnabled);

  const mutation = mutations.create({
    mutation: async (next: boolean) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: { scriptsEnabled: next },
      });
      if (!res.ok) throw new Error("Failed to update scripting setting");
      return res.json();
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => {
      // Revert on failure so the toggle reflects the persisted state.
      setEnabled(props.notebook.scriptsEnabled);
      prompts.error(err.message);
    },
  });

  const handleToggle = async (event: Event) => {
    // The browser already flipped the native checkbox by the time
    // this fires. Capture the input element so we can revert the DOM
    // when the user cancels — Solid won't re-render `checked` if the
    // signal value didn't change, so the visual state would otherwise
    // diverge from the persisted setting (codex review on commit
    // 14642fc).
    const input = event.currentTarget as HTMLInputElement;
    const next = !enabled();
    if (next) {
      // Confirm before turning ON — the warning copy needs an
      // explicit "yes I understand" gesture, not just a tap.
      const confirmed = await prompts.confirm(
        `Scripts in this notebook can read your notes, modify content, and call any browser API on your behalf — only enable for notebooks you trust.\n\nEnable scripting in "${props.notebook.name}"?`,
        {
          title: "Enable scripting",
          icon: "ti ti-alert-triangle",
          variant: "danger",
          confirmText: "Enable",
        },
      );
      if (!confirmed) {
        input.checked = false;
        return;
      }
    }
    setEnabled(next);
    mutation.mutate(next);
  };

  return (
    <div class="flex flex-col gap-3">
      <h3 class="section-label mb-0 flex items-center gap-2">
        <i class="ti ti-code text-dimmed" />
        Scripting
      </h3>
      <p class="text-xs text-dimmed">
        When enabled, fenced code blocks tagged{" "}
        <code class="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px]">```script</code>{" "}
        evaluate as JavaScript in the editor. Scripts run with the same permissions as your browser session — only enable for notebooks you trust.
      </p>
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled()}
          disabled={mutation.loading()}
          onChange={handleToggle}
          class="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
        />
        <span class="text-sm">
          Enable scripting in this notebook
          {mutation.loading() && <i class="ti ti-loader-2 animate-spin ml-2 text-xs" />}
        </span>
      </label>
    </div>
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
      if (!res.ok) throw new Error("Failed to delete notebook");
    },
    onSuccess: () => {
      navigateTo("/app/notebooks");
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Delete "${props.notebook.name}" and all its notes? This cannot be undone.`, {
      title: "Delete Notebook",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (confirmed) mutation.mutate(undefined);
  };

  return (
    <div class="flex flex-col gap-3">
      <h3 class="section-label mb-0 flex items-center gap-2 text-red-600 dark:text-red-400">
        <i class="ti ti-alert-triangle" />
        Danger Zone
      </h3>
      <p class="text-xs text-dimmed">Deleting this notebook will permanently remove all notes and their version history.</p>
      <button type="button" onClick={handleDelete} disabled={mutation.loading()} class="btn-danger btn-md self-start">
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-trash mr-1" />
            Delete Notebook
          </>
        )}
      </button>
    </div>
  );
}

// =============================================================================
// Main Settings Panel
// =============================================================================

export default function NotebookSettingsPanel(props: Props) {
  const backUrl = `/app/notebooks/${props.notebook.shortId}`;

  return (
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-xl mx-auto py-6 px-4 flex flex-col gap-8">
        {/* Header */}
        <div class="flex items-center gap-3">
          <a href={backUrl} class="p-1.5 text-dimmed hover:text-primary transition-colors" title="Back to editor">
            <i class="ti ti-arrow-left" />
          </a>
          <h2 class="text-lg font-semibold">Notebook Settings</h2>
        </div>

        {/* General */}
        {props.canWrite && <GeneralSection notebook={props.notebook} />}

        {/* Homepage */}
        {props.canWrite && <HomepageSection notebook={props.notebook} tree={props.tree} />}

        {/* Scripting (admin-only opt-in for `\`\`\`script` blocks) */}
        {props.isAdmin && <ScriptingSection notebook={props.notebook} />}

        {/* Permissions */}
        {props.isAdmin && (
          <>
            <hr class="border-zinc-200 dark:border-zinc-700" />
            <div class="flex flex-col gap-4">
              <h3 class="section-label mb-0 flex items-center gap-2">
                <i class="ti ti-shield text-dimmed" />
                Permissions
              </h3>
              <PermissionEditor
                initialEntries={props.accessEntries}
                canEdit
                grantAccess={async (principal, permission) => {
                  const res = await apiClient[":id"].access.$post({
                    param: { id: props.notebook.shortId },
                    json: { principal, permission },
                  });
                  if (!res.ok) throw new Error("Failed to grant access");
                  return res.json() as Promise<AccessEntry>;
                }}
                updateAccess={async (accessId, permission) => {
                  const res = await apiClient[":id"].access[":accessId"].$patch({
                    param: { id: props.notebook.shortId, accessId },
                    json: { permission },
                  });
                  if (!res.ok) throw new Error("Failed to update access");
                }}
                revokeAccess={async (accessId) => {
                  const res = await apiClient[":id"].access[":accessId"].$delete({
                    param: { id: props.notebook.shortId, accessId },
                  });
                  if (!res.ok) throw new Error("Failed to revoke access");
                }}
              />
            </div>
          </>
        )}

        {/* Danger Zone */}
        {props.isAdmin && (
          <>
            <hr class="border-zinc-200 dark:border-zinc-700" />
            <DangerZone notebook={props.notebook} />
          </>
        )}
      </div>
    </div>
  );
}
