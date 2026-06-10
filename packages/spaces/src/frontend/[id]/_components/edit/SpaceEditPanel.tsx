import {
  ColorInput,
  CopyButton,
  PermissionEditor,
  prompts,
  ResourceApiKeys,
  type ResourceApiKey,
  SegmentedControl,
  SettingsModal,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { AccessEntry, Priority, SpaceColumn, SpaceDetail, SpaceTag } from "@/contracts";
import {
  type DetailPanelWidth,
  type EventsDaysAhead,
  readAllSettings,
  readWidgetSettings,
  type SpaceUserSettings,
  type ViewType,
  type WidgetSettings,
  writeAllSettings,
  writeWidgetSettings,
} from "@/frontend/[id]/_components/settings/SpaceSettingsStore";
import { requestCurrentSpacesRouteRefresh, requestSpacesRouteNavigation } from "../workspace/workspace-events";

type Props = {
  space: SpaceDetail;
  baseUrl: string;
  initialSettings: SpaceUserSettings;
  onClose?: () => void;
  /** Access entries for permission management (requires admin) */
  accessEntries?: AccessEntry[];
  /** Resource-bound API keys for this space (requires admin) */
  apiKeys?: ResourceApiKey[];
  /** Whether the current user has admin permission on this space */
  isAdmin?: boolean;
};

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const data = await response.json().catch(() => null);
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  return fallback;
};

/**
 * Space Edit Panel - All space editing functionality in one island.
 * Contains: Space settings form, local settings, tags manager, status manager, iCal section, danger zone.
 */
export default function SpaceEditPanel(props: Props) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Space settings"
        subtitle={props.space.name}
        icon="ti ti-layout-kanban"
        onClose={props.onClose ?? (() => requestSpacesRouteNavigation(`/app/spaces/${props.space.id}`, { scroll: "preserve" }))}
        closeLabel="Close settings"
      >
        <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, description, and color.">
          <SpaceSettingsForm space={props.space} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="defaults"
          title="Defaults"
          icon="ti ti-layout-sidebar"
          description="Personal defaults for this space and home widgets."
        >
          <div class="flex flex-col gap-6">
            <LocalSettingsForm spaceId={props.space.id} initialSettings={props.initialSettings} />
            <div class="border-t border-zinc-200 pt-6 dark:border-zinc-700">
              <WidgetSettingsForm />
            </div>
          </div>
        </SettingsModal.Tab>

        <SettingsModal.Tab id="tags" title="Tags" icon="ti ti-tags" description="Vocabulary used to categorize space items.">
          <TagsManager spaceId={props.space.id} tags={props.space.tags} />
        </SettingsModal.Tab>

        <SettingsModal.Tab id="statuses" title="Statuses" icon="ti ti-columns-3" description="Kanban columns and item workflow states.">
          <StatusManager spaceId={props.space.id} columns={props.space.columns} />
        </SettingsModal.Tab>

        {props.isAdmin && props.accessEntries && (
          <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
            <div class="flex flex-col gap-6">
              <PermissionEditor
                initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
                canEdit={props.isAdmin}
                grantAccess={async (principal, permission) => {
                  const res = await apiClient[":id"].access.$post({
                    param: { id: props.space.id },
                    json: { principal, permission },
                  });
                  if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to grant access"));
                  return res.json();
                }}
                updateAccess={async (accessId, permission) => {
                  const res = await apiClient[":id"].access[":accessId"].$patch({
                    param: { id: props.space.id, accessId },
                    json: { permission },
                  });
                  if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update permission"));
                }}
                revokeAccess={async (accessId) => {
                  const res = await apiClient[":id"].access[":accessId"].$delete({
                    param: { id: props.space.id, accessId },
                  });
                  if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke access"));
                }}
              />
              <div class="border-t border-zinc-200 pt-6 dark:border-zinc-700">
                <ResourceApiKeys
                  title="API keys"
                  description="Resource-bound keys for integrations that need access to this space."
                  initialKeys={props.apiKeys ?? []}
                  createKey={async (input) => {
                    const res = await apiClient[":id"]["api-keys"].$post({
                      param: { id: props.space.id },
                      json: input,
                    });
                    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create API key."));
                    return (await res.json()) as { credential: ResourceApiKey; token: string };
                  }}
                  revokeKey={async (credentialId) => {
                    const res = await apiClient[":id"]["api-keys"][":credentialId"].$delete({
                      param: { id: props.space.id, credentialId },
                    });
                    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke API key."));
                  }}
                />
              </div>
            </div>
          </SettingsModal.Tab>
        )}

        <SettingsModal.Tab id="calendar" title="Calendar" icon="ti ti-calendar-share" description="iCal export and subscription URL.">
          <ICalSection spaceId={props.space.id} icalToken={props.space.icalToken} baseUrl={props.baseUrl} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="danger"
          title="Danger zone"
          icon="ti ti-alert-triangle"
          description="Permanently delete this space and all of its items."
          tone="danger"
        >
          <DangerZone spaceId={props.space.id} spaceName={props.space.name} />
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  );
}

// =============================================================================
// Space Settings Form
// =============================================================================

function SpaceSettingsForm(props: { space: SpaceDetail }) {
  const [name, setName] = createSignal(props.space.name);
  const [description, setDescription] = createSignal(props.space.description ?? "");
  const [color, setColor] = createSignal(props.space.color);
  const [hasChanges, setHasChanges] = createSignal(false);

  const updateField =
    <T,>(setter: (v: T) => void) =>
    (value: T) => {
      setter(value);
      setHasChanges(true);
    };

  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.space.id },
        json: {
          name: name(),
          description: description() || null,
          color: color(),
        },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to save");
      }
    },
    onSuccess: () => {
      setHasChanges(false);
      toast.success("Space settings saved");
      requestCurrentSpacesRouteRefresh();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    mutation.mutate({});
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-3">
      <TextInput label="Name" placeholder="My Space" icon="ti ti-typography" value={name} onInput={updateField(setName)} required />

      <TextInput
        label="Description"
        placeholder="Optional description..."
        icon="ti ti-align-left"
        value={description}
        onInput={updateField(setDescription)}
        multiline
      />

      <ColorInput label="Color" value={color} onChange={updateField(setColor)} />

      <Show when={hasChanges()}>
        <button type="submit" disabled={mutation.loading()} class="btn-primary btn-sm self-start mt-2">
          {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
        </button>
      </Show>
    </form>
  );
}

// =============================================================================
// Local Settings Form
// =============================================================================

const VIEW_OPTIONS: { value: ViewType; label: string; icon: string }[] = [
  { value: "list", label: "List", icon: "ti-list-check" },
  { value: "table", label: "Table", icon: "ti-table" },
  { value: "kanban", label: "Kanban", icon: "ti-layout-kanban" },
  { value: "calendar", label: "Calendar", icon: "ti-calendar" },
];

const WIDTH_OPTIONS: { value: DetailPanelWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "medium", label: "Medium" },
  { value: "wide", label: "Wide" },
  { value: "xl", label: "XL" },
];

function LocalSettingsForm(props: { spaceId: string; initialSettings: SpaceUserSettings }) {
  const [settings, setSettings] = createSignal<SpaceUserSettings>(props.initialSettings);

  const updateSetting = <K extends keyof SpaceUserSettings>(key: K, value: SpaceUserSettings[K]) => {
    const newSettings = { ...settings(), [key]: value };
    setSettings(newSettings);

    // Save to cookie
    const allSettings = readAllSettings();
    allSettings.spaces[props.spaceId] = newSettings;
    writeAllSettings(allSettings);
  };

  return (
    <div class="flex flex-col gap-4">
      {/* Default View */}
      <div class="flex flex-col gap-1">
        <p class="text-xs text-secondary">Default View</p>
        <SegmentedControl
          options={VIEW_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            icon: `ti ${o.icon}`,
          }))}
          value={() => settings().view}
          onChange={(v) => updateSetting("view", v)}
        />
      </div>

      {/* Default Panel Width */}
      <div class="flex flex-col gap-1">
        <p class="text-xs text-secondary">Default Panel Width</p>
        <SegmentedControl
          options={WIDTH_OPTIONS}
          value={() => settings().detailPanelWidth}
          onChange={(v) => updateSetting("detailPanelWidth", v)}
        />
      </div>

      <p class="text-xs text-dimmed">
        These are your personal defaults for this space. You can temporarily override them using the sidebar settings.
      </p>
    </div>
  );
}

// =============================================================================
// Widget Settings Form (Global - applies to all spaces)
// =============================================================================

const EVENTS_DAYS_OPTIONS = [
  { value: "1" as const, label: "Today" },
  { value: "3" as const, label: "3 days" },
  { value: "7" as const, label: "1 week" },
  { value: "14" as const, label: "2 weeks" },
];

const TASKS_PRIORITY_OPTIONS = [
  { value: "" as const, label: "All" },
  { value: "low" as const, label: "Low+" },
  { value: "medium" as const, label: "Med+" },
  { value: "high" as const, label: "High+" },
  { value: "urgent" as const, label: "Urgent" },
];

function WidgetSettingsForm() {
  const [settings, setSettings] = createSignal<WidgetSettings>(readWidgetSettings());

  const updateSetting = <K extends keyof WidgetSettings>(key: K, value: WidgetSettings[K]) => {
    const newSettings = { ...settings(), [key]: value };
    setSettings(newSettings);
    writeWidgetSettings(newSettings);
  };

  return (
    <div class="flex flex-col gap-4">
      {/* Events Widget: Days Ahead */}
      <div class="flex flex-col gap-1">
        <p class="text-xs text-secondary">Events: Time Range</p>
        <SegmentedControl
          options={EVENTS_DAYS_OPTIONS}
          value={() => String(settings().eventsDaysAhead)}
          onChange={(v) => updateSetting("eventsDaysAhead", Number(v) as EventsDaysAhead)}
        />
      </div>

      {/* Tasks Widget: Min Priority */}
      <div class="flex flex-col gap-1">
        <p class="text-xs text-secondary">Tasks: Minimum Priority</p>
        <SegmentedControl
          options={TASKS_PRIORITY_OPTIONS}
          value={() => settings().tasksMinPriority ?? ""}
          onChange={(v) => updateSetting("tasksMinPriority", (v || null) as Priority | null)}
        />
      </div>

      <p class="text-xs text-dimmed">These settings apply to the home page widgets across all spaces, not just this one.</p>
    </div>
  );
}

// =============================================================================
// Tags Manager
// =============================================================================

function TagsManager(props: { spaceId: string; tags: SpaceTag[] }) {
  const [tags, setTags] = createSignal([...props.tags]);
  const [editingId, setEditingId] = createSignal<string | null>(null);

  const createMut = mutations.create({
    mutation: async (data: { name: string; color: string }) => {
      const res = await apiClient[":id"].tags.$post({
        param: { id: props.spaceId },
        json: data,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to create tag");
      }
      return res.json();
    },
    onSuccess: (newTag) => {
      setTags([...tags(), newTag as SpaceTag]);
      toast.success("Tag created");
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateMut = mutations.create({
    mutation: async (data: { id: string; name: string; color: string }) => {
      const res = await apiClient[":id"].tags[":tagId"].$patch({
        param: { id: props.spaceId, tagId: data.id },
        json: { name: data.name, color: data.color },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to update tag");
      }
      return res.json();
    },
    onSuccess: (updated) => {
      setTags(tags().map((t) => (t.id === (updated as SpaceTag).id ? (updated as SpaceTag) : t)));
      setEditingId(null);
      toast.success("Tag updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMut = mutations.create<SpaceTag | null, SpaceTag>({
    mutation: async (tag: SpaceTag) => {
      const confirmed = await prompts.confirm("Delete this tag?", {
        title: "Delete Tag",
        variant: "danger",
      });
      if (!confirmed) return null;

      const res = await apiClient[":id"].tags[":tagId"].$delete({
        param: { id: props.spaceId, tagId: tag.id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to delete tag");
      }
      return tag;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      setTags(tags().filter((t) => t.id !== deleted.id));
      toast.success("Tag deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col border-l-2 border-zinc-200 dark:border-zinc-700">
      <For each={tags()}>
        {(tag) => (
          <Show
            when={editingId() === tag.id}
            fallback={<TagRow tag={tag} onEdit={() => setEditingId(tag.id)} onDelete={() => deleteMut.mutate(tag)} />}
          >
            <TagForm
              tag={tag}
              onSave={(data) => updateMut.mutate({ id: tag.id, ...data })}
              onCancel={() => setEditingId(null)}
              loading={updateMut.loading()}
            />
          </Show>
        )}
      </For>

      <AddTagButton onSave={(data) => createMut.mutate(data)} loading={createMut.loading()} />
    </div>
  );
}

function TagRow(props: { tag: SpaceTag; onEdit: () => void; onDelete: () => void }) {
  return (
    <div class="group/tag pl-3 py-0.5 flex items-center gap-2">
      <span class="w-4 h-4 rounded-full shrink-0" style={`background-color: ${props.tag.color}`} />
      <span class="flex-1 text-sm truncate">{props.tag.name}</span>
      <div class="flex items-center gap-1 opacity-0 group-hover/tag:opacity-100 transition-opacity">
        <button type="button" onClick={props.onEdit} class="p-1 w-6 h-6 flex items-center justify-center text-dimmed hover:text-primary">
          <i class="ti ti-pencil text-sm" />
        </button>
        <button type="button" onClick={props.onDelete} class="p-1 w-6 h-6 flex items-center justify-center text-dimmed hover:text-red-500">
          <i class="ti ti-x text-sm" />
        </button>
      </div>
    </div>
  );
}

function TagForm(props: {
  tag?: SpaceTag;
  onSave: (data: { name: string; color: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [name, setName] = createSignal(props.tag?.name ?? "");
  const [color, setColor] = createSignal(props.tag?.color ?? "#6b7280");
  const isNew = () => !props.tag;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) return;
    props.onSave({ name: name(), color: color() });
    if (isNew()) {
      setName("");
      setColor("#6b7280");
    }
  };

  return (
    <form onSubmit={handleSubmit} class="ml-2 paper p-3 flex flex-col gap-2">
      <TextInput label="Name" placeholder="Tag name" value={name} onInput={setName} required />
      <ColorInput label="Color" value={color} onChange={setColor} />
      <div class="flex gap-2 mt-1">
        <button type="submit" disabled={props.loading} class="btn-primary btn-sm">
          {props.loading ? <i class="ti ti-loader-2 animate-spin" /> : isNew() ? "Create" : "Save"}
        </button>
        <button type="button" onClick={props.onCancel} class="btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddTagButton(props: { onSave: (data: { name: string; color: string }) => void; loading: boolean }) {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <Show
      when={isOpen()}
      fallback={
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          class="pl-3 py-1 flex items-center gap-2 text-sm text-dimmed hover:text-primary transition-colors"
        >
          <i class="ti ti-plus" />
          <span>Add tag</span>
        </button>
      }
    >
      <TagForm
        onSave={(data) => {
          props.onSave(data);
          setIsOpen(false);
        }}
        onCancel={() => setIsOpen(false)}
        loading={props.loading}
      />
    </Show>
  );
}

// =============================================================================
// Status Manager
// =============================================================================

function StatusManager(props: { spaceId: string; columns: SpaceColumn[] }) {
  const [columns, setColumns] = createSignal([...props.columns]);
  const [editingId, setEditingId] = createSignal<string | null>(null);

  const createMut = mutations.create({
    mutation: async (data: { name: string; color?: string }) => {
      const res = await apiClient[":id"].columns.$post({
        param: { id: props.spaceId },
        json: data,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to create status");
      }
      return res.json();
    },
    onSuccess: (newColumn) => {
      setColumns([...columns(), newColumn as SpaceColumn]);
      toast.success("Status created");
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateMut = mutations.create({
    mutation: async (data: { id: string; name: string; color: string | null }) => {
      const res = await apiClient[":id"].columns[":columnId"].$patch({
        param: { id: props.spaceId, columnId: data.id },
        json: { name: data.name, color: data.color },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to update status");
      }
      return res.json();
    },
    onSuccess: (updated) => {
      setColumns(columns().map((c) => (c.id === (updated as SpaceColumn).id ? (updated as SpaceColumn) : c)));
      setEditingId(null);
      toast.success("Status updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMut = mutations.create<SpaceColumn | null, SpaceColumn>({
    mutation: async (column: SpaceColumn) => {
      const confirmed = await prompts.confirm(`Delete status "${column.name}"?`, {
        title: "Delete Status",
        variant: "danger",
      });
      if (!confirmed) return null;

      const res = await apiClient[":id"].columns[":columnId"].$delete({
        param: { id: props.spaceId, columnId: column.id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to delete status");
      }
      return column;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      setColumns(columns().filter((c) => c.id !== deleted.id));
      toast.success("Status deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  const reorderMut = mutations.create({
    mutation: async (columnIds: string[]) => {
      const res = await apiClient[":id"].columns.order.$put({
        param: { id: props.spaceId },
        json: { columnIds },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to reorder");
      }
    },
    onError: (err) => prompts.error(err.message),
  });

  const moveColumn = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= columns().length) return;

    const newColumns = [...columns()];
    const [moved] = newColumns.splice(index, 1);
    newColumns.splice(newIndex, 0, moved!);
    setColumns(newColumns);

    reorderMut.mutate(newColumns.map((c) => c.id));
  };

  return (
    <div class="flex flex-col border-l-2 border-zinc-200 dark:border-zinc-700">
      <For each={columns()}>
        {(column, index) => (
          <Show
            when={editingId() === column.id}
            fallback={
              <StatusRow
                column={column}
                index={index()}
                total={columns().length}
                onEdit={() => setEditingId(column.id)}
                onDelete={() => deleteMut.mutate(column)}
                onMoveUp={() => moveColumn(index(), -1)}
                onMoveDown={() => moveColumn(index(), 1)}
              />
            }
          >
            <StatusForm
              column={column}
              onSave={(data) =>
                updateMut.mutate({
                  id: column.id,
                  name: data.name,
                  color: data.color ?? null,
                })
              }
              onCancel={() => setEditingId(null)}
              loading={updateMut.loading()}
            />
          </Show>
        )}
      </For>

      <AddStatusButton onSave={createMut.mutate} loading={createMut.loading()} />
    </div>
  );
}

function StatusRow(props: {
  column: SpaceColumn;
  index: number;
  total: number;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div class="group/status pl-3 py-0.5 flex items-center gap-2">
      <span class="w-4 h-4 rounded-full shrink-0" style={`background-color: ${props.column.color || "#6b7280"}`} />
      <span class="flex-1 text-sm truncate">{props.column.name}</span>
      <div class="flex items-center gap-1 opacity-0 group-hover/status:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={props.onMoveUp}
          disabled={props.index === 0}
          class="p-1 w-6 h-6 flex items-center justify-center text-dimmed hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <i class="ti ti-arrow-up text-sm" />
        </button>
        <button
          type="button"
          onClick={props.onMoveDown}
          disabled={props.index === props.total - 1}
          class="p-1 w-6 h-6 flex items-center justify-center text-dimmed hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <i class="ti ti-arrow-down text-sm" />
        </button>
        <button type="button" onClick={props.onEdit} class="p-1 w-6 h-6 flex items-center justify-center text-dimmed hover:text-primary">
          <i class="ti ti-pencil text-sm" />
        </button>
        <button type="button" onClick={props.onDelete} class="p-1 w-6 h-6 flex items-center justify-center text-dimmed hover:text-red-500">
          <i class="ti ti-x text-sm" />
        </button>
      </div>
    </div>
  );
}

function StatusForm(props: {
  column?: SpaceColumn;
  onSave: (data: { name: string; color?: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [name, setName] = createSignal(props.column?.name ?? "");
  const [color, setColor] = createSignal(props.column?.color ?? "#6b7280");
  const isNew = () => !props.column;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) return;
    props.onSave({ name: name(), color: color() });
    if (isNew()) {
      setName("");
      setColor("#6b7280");
    }
  };

  return (
    <form onSubmit={handleSubmit} class="ml-2 paper p-3 flex flex-col gap-2">
      <TextInput label="Name" placeholder="Status name" value={name} onInput={setName} required />
      <ColorInput label="Color" value={color} onChange={setColor} />
      <div class="flex gap-2 mt-1">
        <button type="submit" disabled={props.loading} class="btn-primary btn-sm">
          {props.loading ? <i class="ti ti-loader-2 animate-spin" /> : isNew() ? "Create" : "Save"}
        </button>
        <button type="button" onClick={props.onCancel} class="btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddStatusButton(props: { onSave: (data: { name: string; color?: string }) => void; loading: boolean }) {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <Show
      when={isOpen()}
      fallback={
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          class="pl-3 py-1 flex items-center gap-2 text-sm text-dimmed hover:text-primary transition-colors"
        >
          <i class="ti ti-plus" />
          <span>Add status</span>
        </button>
      }
    >
      <StatusForm
        onSave={(data) => {
          props.onSave(data);
          setIsOpen(false);
        }}
        onCancel={() => setIsOpen(false)}
        loading={props.loading}
      />
    </Show>
  );
}

// =============================================================================
// iCal Section
// =============================================================================

function ICalSection(props: { spaceId: string; icalToken: string | null; baseUrl: string }) {
  const [token, setToken] = createSignal(props.icalToken);

  const regenerateMut = mutations.create({
    mutation: async () => {
      const confirmed = await prompts.confirm("Regenerating the token will invalidate the current URL. Continue?", {
        title: "Regenerate Token",
        variant: "danger",
      });
      if (!confirmed) return null;

      const res = await apiClient[":id"]["regenerate-ical-token"].$post({
        param: { id: props.spaceId },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to regenerate token");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (!data) return;
      setToken((data as { icalToken: string }).icalToken);
      toast.success("iCal token regenerated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const icalUrl = () => (token() ? `${props.baseUrl}/api/spaces/calendar/ical/${token()}.ics` : null);

  return (
    <div class="flex flex-col gap-3">
      <Show when={icalUrl()} fallback={<p class="text-sm text-dimmed">No iCal token available.</p>}>
        <div class="flex items-center gap-2">
          <input
            type="text"
            value={icalUrl()!}
            readonly
            class="flex-1 px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700 font-mono"
          />
          <CopyButton text={icalUrl()!} />
        </div>
        <div class="text-xs text-dimmed space-y-1">
          <p>
            <strong>Thunderbird:</strong> New Calendar → On the Network → iCalendar (ICS)
          </p>
          <p>
            <strong>Google Calendar:</strong> Settings → Add calendar → From URL
          </p>
          <p>
            <strong>Apple Calendar:</strong> File → New Calendar Subscription
          </p>
          <p>
            <strong>Outlook:</strong> Add calendar → Subscribe from web
          </p>
        </div>
        <button
          type="button"
          onClick={() => regenerateMut.mutate(undefined)}
          disabled={regenerateMut.loading()}
          class="text-xs text-red-500 hover:text-red-600 self-start"
        >
          {regenerateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Regenerate token"}
        </button>
      </Show>
    </div>
  );
}

// =============================================================================
// Danger Zone
// =============================================================================

function DangerZone(props: { spaceId: string; spaceName: string }) {
  const deleteMut = mutations.create({
    mutation: async () => {
      const confirmed = await prompts.confirm(
        `Are you sure you want to delete "${props.spaceName}"? This will permanently delete all items, tags, and comments. This action cannot be undone.`,
        { title: "Delete Space", variant: "danger" },
      );
      if (!confirmed) return false;

      const res = await apiClient[":id"].$delete({
        param: { id: props.spaceId },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to delete space");
      }
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Space deleted");
      navigateTo("/app/spaces");
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col gap-2">
      <p class="text-sm text-secondary">Permanently delete this space and all its contents.</p>
      <button type="button" onClick={() => deleteMut.mutate(undefined)} disabled={deleteMut.loading()} class="btn-danger btn-md self-start">
        {deleteMut.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-trash mr-1" />
            Delete Space
          </>
        )}
      </button>
    </div>
  );
}
