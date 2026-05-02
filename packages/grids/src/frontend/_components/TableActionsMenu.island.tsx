import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Table } from "../../service";
import { errorMessage } from "./api-helpers";

type Props = {
  table: { id: string; name: string };
  canManage: boolean;
};

export default function TableActionsMenu(props: Props) {
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
