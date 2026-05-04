import { prompts, navigateTo } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Table } from "../../service";
import { errorMessage } from "./api-helpers";

export default function CreateTableButton(props: { baseId: string }) {
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
      // Match the rest of the sidebar — `sidebar-item` sets the right
      // text-xs / text-dimmed / hover-bg defaults so this row sits
      // visually alongside Tables. Same pattern as contacts'
      // CreateBookButton.
      class="sidebar-item w-full"
      onClick={handleClick}
      disabled={createMutation.loading()}
    >
      {createMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      New table
    </button>
  );
}
