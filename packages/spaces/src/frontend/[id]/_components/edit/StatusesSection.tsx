import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, IconButton, prompts, SettingsCollection, SettingsGroup, toast } from "@k2b/ui";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceColumn } from "@/contracts";
import { NameColorForm } from "./NameColorForm";
import { readErrorMessage } from "./utils";

export function StatusesSection(props: {
  spaceId: string;
  columns: SpaceColumn[];
  onWorkspaceChange?: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [columns, setColumns] = createSignal([...props.columns]);
  const [editingId, setEditingId] = createSignal<string | "new" | null>(null);

  createEffect(() => props.onDirtyChange(editingId() !== null));
  onCleanup(() => props.onDirtyChange(false));

  const createMut = mutations.create({
    mutation: async (data: { name: string; color?: string }) => {
      const res = await apiClient[":id"].columns.$post({
        param: { id: props.spaceId },
        json: data,
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to create status"));
      }
      return res.json();
    },
    onSuccess: (newColumn) => {
      setColumns([...columns(), newColumn as SpaceColumn]);
      setEditingId(null);
      toast.success("Status created");
      props.onWorkspaceChange?.();
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
        throw new Error(await readErrorMessage(res, "Failed to update status"));
      }
      return res.json();
    },
    onSuccess: (updated) => {
      setColumns(columns().map((c) => (c.id === (updated as SpaceColumn).id ? (updated as SpaceColumn) : c)));
      setEditingId(null);
      toast.success("Status updated");
      props.onWorkspaceChange?.();
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
        throw new Error(await readErrorMessage(res, "Failed to delete status"));
      }
      return column;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      setColumns(columns().filter((c) => c.id !== deleted.id));
      toast.success("Status deleted");
      props.onWorkspaceChange?.();
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
        throw new Error(await readErrorMessage(res, "Failed to reorder"));
      }
    },
    onSuccess: () => props.onWorkspaceChange?.(),
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
    <>
      <Show when={editingId()}>
        {(id) => {
          const column = () => columns().find((item) => item.id === id());
          return (
            <SettingsGroup
              title={id() === "new" ? "New status" : `Edit ${column()?.name ?? "status"}`}
              description="Choose a concise workflow label and recognizable color."
            >
              <NameColorForm
                mode={id() === "new" ? "create" : "edit"}
                initialName={column()?.name}
                initialColor={column()?.color}
                nameLabel="Name"
                namePlaceholder="In progress"
                createLabel="Create status"
                onSave={(data) => {
                  const current = column();
                  if (id() === "new") createMut.mutate(data);
                  else if (current) updateMut.mutate({ id: current.id, name: data.name, color: data.color ?? null });
                }}
                onCancel={() => setEditingId(null)}
                loading={createMut.loading() || updateMut.loading()}
              />
            </SettingsGroup>
          );
        }}
      </Show>

      <SettingsCollection
        title="Workflow statuses"
        description="Ordered stages used by Kanban and item status controls. Changes save immediately."
        empty="No statuses yet. Create one to organize work."
      >
        <SettingsCollection.Action>
          <Button type="button" size="sm" disabled={editingId() !== null} onClick={() => setEditingId("new")}>
            <i class="ti ti-plus" aria-hidden="true" />
            New status
          </Button>
        </SettingsCollection.Action>
        <For each={columns()}>
          {(column, index) => (
            <SettingsCollection.Item
              title={column.name}
              description={`Position ${index() + 1} of ${columns().length}`}
              icon={<span class="h-3 w-3 rounded-full" style={`background-color:${column.color || "#6b7280"}`} />}
            >
              <SettingsCollection.Item.Actions>
                <SettingsCollection.Item.Reorder
                  label={column.name}
                  index={index()}
                  count={columns().length}
                  disabled={reorderMut.loading()}
                  onMove={(direction) => moveColumn(index(), direction)}
                />
                <IconButton label={`Edit ${column.name}`} size="sm" onClick={() => setEditingId(column.id)} title="Edit status">
                  <i class="ti ti-pencil" aria-hidden="true" />
                </IconButton>
                <IconButton label={`Delete ${column.name}`} size="sm" onClick={() => deleteMut.mutate(column)} title="Delete status">
                  <i class="ti ti-trash" aria-hidden="true" />
                </IconButton>
              </SettingsCollection.Item.Actions>
            </SettingsCollection.Item>
          )}
        </For>
      </SettingsCollection>
    </>
  );
}
