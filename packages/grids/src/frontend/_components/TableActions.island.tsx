import { prompts, navigateTo, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Table } from "../../service";
import { errorMessage } from "./api-helpers";


export function CreateTableButton(props: { baseId: string }) {
  const createMutation = mutations.create<Table, { name: string }>({
    mutation: async (input) => {
      const res = await apiClient.tables["by-base"][":baseId"].$post({
        param: { baseId: props.baseId },
        json: { name: input.name },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create table"));
      return (await res.json()) as Table;
    },
    onSuccess: (table) => navigateTo(`/app/grids/${props.baseId}?table=${table.id}`),
    onError: (e) => prompts.error(e.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "New table",
      icon: "ti ti-table-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. Tasks, Contacts" },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createMutation.mutate({ name: String(result.name).trim() });
  };

  return (
    <button
      type="button"
      class="btn-simple btn-sm w-full text-left text-sm text-secondary hover:text-primary px-2 py-1.5"
      onClick={handleClick}
      disabled={createMutation.loading()}
    >
      <i class="ti ti-plus text-xs" /> New table
    </button>
  );
}

export function TableActionsMenu(props: {
  table: { id: string; name: string };
  canManage: boolean;
}) {
  const renameMutation = mutations.create<Table, { name: string }>({
    mutation: async (input) => {
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.table.id },
        json: { name: input.name },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to rename table"));
      return (await res.json()) as Table;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const deleteMutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$delete({ param: { tableId: props.table.id } });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete table"));
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const handleRename = async () => {
    const result = await prompts.form({
      title: "Rename table",
      icon: "ti ti-edit",
      fields: { name: { type: "text", label: "Name", required: true, default: props.table.name } },
      confirmText: "Save",
    });
    if (!result) return;
    renameMutation.mutate({ name: String(result.name).trim() });
  };

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(
      `Permanently delete "${props.table.name}" and all of its fields, records, and audit history. This cannot be undone.`,
      { title: "Delete table?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMutation.mutate(undefined);
  };

  if (!props.canManage) return null;

  return (
    <div class="flex items-center gap-1">
      <button type="button" class="btn-simple btn-sm text-xs" onClick={handleRename} title="Rename">
        <i class="ti ti-edit" />
      </button>
      <button
        type="button"
        class="btn-simple btn-sm text-xs text-red-500 hover:text-red-600"
        onClick={handleDelete}
        title="Delete"
      >
        <i class="ti ti-trash" />
      </button>
    </div>
  );
}
