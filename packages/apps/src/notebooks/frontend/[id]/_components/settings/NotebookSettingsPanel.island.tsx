import { createSignal } from "solid-js";
import { apiClient } from "@/notebooks/client";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { PermissionEditor, SelectInput, TextInput } from "@valentinkolb/cloud/lib/ui";
import { icons } from "@valentinkolb/cloud/lib/shared";
import type { Notebook } from "../sidebar/types";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts/shared";
import { refreshCurrentPath } from "../../../lib/navigation";

type Props = {
  notebook: Notebook;
  accessEntries: AccessEntry[];
  isAdmin: boolean;
  canWrite: boolean;
};

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
        param: { id: props.notebook.id },
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

      <SelectInput
        label="Icon"
        value={() => icon()}
        onChange={setIcon}
        placeholder="Select an icon..."
        options={icons.ICON_OPTIONS}
        clearable
        icon="ti ti-icons"
      />

      <button type="button" onClick={handleSave} disabled={mutation.loading() || !hasChanges()} class="btn-primary btn-md self-start">
        {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
      </button>
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
        param: { id: props.notebook.id },
      });
      if (!res.ok) throw new Error("Failed to delete notebook");
    },
    onSuccess: () => {
      window.location.href = "/app/notebooks";
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Delete "${props.notebook.name}" and all its pages? This cannot be undone.`, {
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
      <p class="text-xs text-dimmed">Deleting this notebook will permanently remove all pages and their version history.</p>
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
  const backUrl = `/app/notebooks/${props.notebook.id}`;

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
                resourceId={props.notebook.id}
                initialEntries={props.accessEntries}
                canEdit
                grantAccess={async (resourceId: string, principal: Principal, permission: PermissionLevel) => {
                  const res = await apiClient[":id"].access.$post({
                    param: { id: resourceId },
                    json: { principal, permission },
                  });
                  if (!res.ok) throw new Error("Failed to grant access");
                  return res.json() as Promise<AccessEntry>;
                }}
                updateAccess={async (resourceId: string, accessId: string, permission: PermissionLevel) => {
                  const res = await apiClient[":id"].access[":accessId"].$patch({
                    param: { id: resourceId, accessId },
                    json: { permission },
                  });
                  if (!res.ok) throw new Error("Failed to update access");
                }}
                revokeAccess={async (resourceId: string, accessId: string) => {
                  const res = await apiClient[":id"].access[":accessId"].$delete({
                    param: { id: resourceId, accessId },
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
