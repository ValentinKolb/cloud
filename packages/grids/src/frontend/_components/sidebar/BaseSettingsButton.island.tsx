import { AppWorkspace, prompts } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";
import { apiClient } from "../../../api/client";
import type { Base } from "../../../service";
import BaseSettingsPanel from "../settings/BaseSettingsPanel";

export default function BaseSettingsButton(props: { base: Base; variant?: "header" | "sidebar" }) {
  const [open, setOpen] = createSignal(false);

  const showSettings = async () => {
    if (open()) return;
    setOpen(true);
    try {
      const [accessResponse, dashboardsResponse] = await Promise.all([
        apiClient.access["by-base"][":baseId"].$get({ param: { baseId: props.base.id } }),
        apiClient.dashboards["by-base"][":baseId"].$get({ param: { baseId: props.base.id } }),
      ]);
      if (!accessResponse.ok || !dashboardsResponse.ok) throw new Error("Could not load settings");
      const [accessEntries, dashboards] = await Promise.all([accessResponse.json(), dashboardsResponse.json()]);
      await prompts.dialog<void>(
        (close) => (
          <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
            <BaseSettingsPanel base={props.base} accessEntries={accessEntries} dashboards={dashboards} onClose={() => close()} />
          </div>
        ),
        { surface: "bare", header: false, size: "large" },
      );
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not open settings");
    } finally {
      setOpen(false);
    }
  };

  return props.variant === "sidebar" ? (
    <AppWorkspace.SidebarItem onClick={() => void showSettings()} disabled={open()}>
      <AppWorkspace.SidebarItemIcon icon={open() ? "ti ti-loader-2 animate-spin" : "ti ti-settings"} />
      <AppWorkspace.SidebarItemLabel>Settings</AppWorkspace.SidebarItemLabel>
    </AppWorkspace.SidebarItem>
  ) : (
    <button
      type="button"
      onClick={() => void showSettings()}
      class="sidebar-header-settings focus-ui inline-flex h-6 w-6 items-center justify-center rounded"
      title="Settings"
      aria-label={`Settings for ${props.base.name}`}
      disabled={open()}
    >
      <i class={open() ? "ti ti-loader-2 animate-spin text-xs" : "ti ti-settings text-xs"} />
    </button>
  );
}
