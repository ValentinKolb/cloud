import { AppWorkspace, prompts } from "@k2b/ui";
import { createSignal } from "solid-js";
import { apiClient } from "../../../api/client";
import type { Base } from "../../../service";
import BaseSettingsPanel from "../settings/BaseSettingsPanel";

export default function BaseSettingsButton(props: { base: Base }) {
  const [open, setOpen] = createSignal(false);

  const showSettings = async () => {
    if (open()) return;
    setOpen(true);
    try {
      const accessResponse = await apiClient.access["by-base"][":baseId"].$get({ param: { baseId: props.base.id } });
      if (!accessResponse.ok) throw new Error("Could not load settings");
      const accessEntries = await accessResponse.json();
      await prompts.dialog<void>(
        (close) => (
          <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
            <BaseSettingsPanel base={props.base} accessEntries={accessEntries} onClose={() => close()} />
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

  return (
    <AppWorkspace.SidebarItem onClick={() => void showSettings()} disabled={open()}>
      <AppWorkspace.SidebarItemIcon icon={open() ? "ti ti-loader-2 animate-spin" : "ti ti-settings"} />
      <AppWorkspace.SidebarItemLabel>Settings</AppWorkspace.SidebarItemLabel>
    </AppWorkspace.SidebarItem>
  );
}
