import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceColumn } from "@/contracts";
import { NameColorForm } from "./NameColorForm";
import { readErrorMessage } from "./utils";

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
      <NameColorForm
        mode="create"
        nameLabel="Name"
        namePlaceholder="Status name"
        createLabel="Create"
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

export function StatusesSection(props: { spaceId: string; columns: SpaceColumn[] }) {
  const [columns, setColumns] = createSignal([...props.columns]);
  const [editingId, setEditingId] = createSignal<string | null>(null);

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
        throw new Error(await readErrorMessage(res, "Failed to update status"));
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
        throw new Error(await readErrorMessage(res, "Failed to delete status"));
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
        throw new Error(await readErrorMessage(res, "Failed to reorder"));
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
            <NameColorForm
              mode="edit"
              initialName={column.name}
              initialColor={column.color}
              nameLabel="Name"
              namePlaceholder="Status name"
              createLabel="Create"
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
