import { prompts, navigateTo } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Dashboard } from "../../service";
import { errorMessage } from "./api-helpers";

/**
 * "+ New dashboard" entry under the Dashboards sidebar section.
 * Mirrors CreateTableButton's pattern: prompts for a name (and an
 * optional shared toggle), POSTs to /dashboards/by-base, and navigates
 * to the new dashboard's edit page so the user lands on a workable
 * surface immediately rather than at an empty viewer.
 */
export default function CreateDashboardButton(props: { baseId: string; baseShortId: string }) {
  const createMutation = mutations.create<
    Dashboard,
    { name: string; shared: boolean }
  >({
    mutation: async (input) => {
      const res = await apiClient.dashboards["by-base"][":baseId"].$post({
        param: { baseId: props.baseId },
        json: { name: input.name, shared: input.shared },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create dashboard"));
      return (await res.json()) as Dashboard;
    },
    // After creation: open the editor. A fresh dashboard has no widgets,
    // so dropping the user on the viewer would just show the empty
    // state — the editor is the next-step destination.
    onSuccess: (d) => navigateTo(`/app/grids/${props.baseShortId}/dashboards/${d.shortId}/edit`),
    onError: (e) => prompts.error(e.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "New dashboard",
      icon: "ti ti-layout-dashboard",
      fields: {
        name: {
          type: "text",
          label: "Name",
          required: true,
          placeholder: "e.g. Bookshop overview, Sales report",
        },
        shared: {
          type: "boolean",
          label: "Share with everyone (read access)",
          description:
            "Personal dashboards are private to you. Shared dashboards are visible to anyone with base-read.",
        },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createMutation.mutate({
      name: String(result.name).trim(),
      shared: Boolean(result.shared),
    });
  };

  return (
    <button
      type="button"
      class="sidebar-item w-full"
      onClick={handleClick}
      disabled={createMutation.loading()}
    >
      {createMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      New dashboard
    </button>
  );
}
