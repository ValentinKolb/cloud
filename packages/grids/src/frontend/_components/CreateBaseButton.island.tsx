import { prompts, navigateTo } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Base } from "../../service";
import { errorMessage } from "./api-helpers";

export default function CreateBaseButton() {
  const createMutation = mutations.create<Base, { name: string; description: string }>({
    mutation: async (input) => {
      const res = await apiClient.bases.$post({
        json: { name: input.name, description: input.description || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create base"));
      return (await res.json()) as Base;
    },
    onSuccess: (base) => navigateTo(`/app/grids/${base.shortId}`),
    onError: (e) => prompts.error(e.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "New base",
      icon: "ti ti-database-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. CRM, Inventory" },
        description: { type: "text", label: "Description", multiline: true, placeholder: "Optional" },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createMutation.mutate({
      name: String(result.name).trim(),
      description: String(result.description ?? "").trim(),
    });
  };

  return (
    <button type="button" class="btn-primary btn-sm" onClick={handleClick} disabled={createMutation.loading()}>
      <i class="ti ti-plus" /> New base
    </button>
  );
}
