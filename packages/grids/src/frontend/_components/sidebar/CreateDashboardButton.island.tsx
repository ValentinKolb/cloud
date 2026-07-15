import { AppWorkspace, prompts } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Dashboard } from "../../../service";
import { errorMessage } from "../utils/api-helpers";

/**
 * "+ New dashboard" entry under the Dashboards sidebar section.
 * Mirrors CreateTableButton's pattern: prompts for a name (and an
 * optional shared toggle), POSTs to /dashboards/by-base, and navigates
 * to the new dashboard's edit page so the user lands on a workable
 * surface immediately rather than at an empty viewer.
 */
export default function CreateDashboardButton(props: { baseId: string; baseShortId: string }) {
  const createMutation = mutations.create<Dashboard, { name: string; shared: boolean }>({
    mutation: async (input) => {
      const res = await apiClient.dashboards["by-base"][":baseId"].$post({
        param: { baseId: props.baseId },
        json: { name: input.name, shared: input.shared },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create dashboard"));
      return res.json();
    },
    // After creation: open edit mode. A fresh dashboard has no widgets,
    // so dropping the user on the viewer would just show the empty
    // state — edit mode is the next-step destination.
    onSuccess: (d) => navigateTo(`/app/grids/${props.baseShortId}/dashboard/${d.shortId}?edit=true`),
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
          description: "Personal dashboards are private to you. Shared dashboards are visible to anyone with base-read.",
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
    <AppWorkspace.SidebarItem disabled={createMutation.loading()} onClick={() => void handleClick()}>
      <AppWorkspace.SidebarItemIcon icon={createMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
      <AppWorkspace.SidebarItemLabel>New dashboard</AppWorkspace.SidebarItemLabel>
    </AppWorkspace.SidebarItem>
  );
}
