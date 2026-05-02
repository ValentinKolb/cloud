import { prompts, navigateTo, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Base } from "../../service";
import { errorMessage } from "./api-helpers";

type Props = {
  base: { id: string; name: string; description: string | null };
  canManage: boolean;
};

export default function BaseSettingsButton(props: Props) {
  const updateMutation = mutations.create<Base, { name: string; description: string }>({
    mutation: async (input) => {
      const res = await apiClient.bases[":baseId"].$patch({
        param: { baseId: props.base.id },
        json: { name: input.name, description: input.description || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update base"));
      return (await res.json()) as Base;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const deleteMutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.bases[":baseId"].$delete({ param: { baseId: props.base.id } });
      // hono-openapi's typed client only declares non-204 statuses, so
      // res.ok is false for 204; check status range manually.
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete base"));
    },
    onSuccess: () => navigateTo("/app/grids"),
    onError: (e) => prompts.error(e.message),
  });

  const handleEdit = async () => {
    const result = await prompts.form({
      title: "Edit base",
      icon: "ti ti-edit",
      fields: {
        name: { type: "text", label: "Name", required: true, default: props.base.name },
        description: {
          type: "text",
          label: "Description",
          multiline: true,
          default: props.base.description ?? "",
        },
      },
      confirmText: "Save",
    });
    if (!result) return;
    updateMutation.mutate({
      name: String(result.name).trim(),
      description: String(result.description ?? "").trim(),
    });
  };

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(
      `This permanently deletes "${props.base.name}" and all of its tables, fields, records, and audit history. This cannot be undone.`,
      { title: "Delete base?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMutation.mutate(undefined);
  };

  if (!props.canManage) return null;

  return (
    <div class="flex items-center gap-1">
      <button type="button" class="btn-simple btn-sm" onClick={handleEdit} title="Edit base">
        <i class="ti ti-edit" />
      </button>
      <button
        type="button"
        class="btn-simple btn-sm text-red-500 hover:text-red-600"
        onClick={handleDelete}
        title="Delete base"
        disabled={deleteMutation.loading()}
      >
        <i class="ti ti-trash" />
      </button>
    </div>
  );
}
