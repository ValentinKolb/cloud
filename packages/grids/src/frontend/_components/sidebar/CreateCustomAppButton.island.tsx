import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { AppWorkspace, Button, dialogCore, PanelDialog, panelDialogOptions, prompts, TextInput } from "@k2b/ui";
import { createSignal } from "solid-js";
import { apiClient } from "../../../api/client";
import type { CustomApp } from "../../../service";
import { errorMessage } from "../utils/api-helpers";

export default function CreateCustomAppButton(props: { baseId: string; baseShortId: string }) {
  const createMutation = mutations.create<CustomApp, string>({
    mutation: async (name) => {
      const response = await apiClient.apps["by-base"][":baseId"].$post({
        param: { baseId: props.baseId },
        json: { name },
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not create the App."));
      return response.json();
    },
    onSuccess: (app) => navigateTo(`/app/grids/${props.baseShortId}/apps/${app.shortId}?edit=true&settings=app`),
    onError: (error) => prompts.error(error.message),
  });

  const createApp = async () => {
    const name = await dialogCore.open<string | null>((close) => {
      const [value, setValue] = createSignal("");
      return (
        <PanelDialog>
          <PanelDialog.Header
            title="New App"
            subtitle="Start with one editable Home page."
            icon="ti ti-app-window"
            close={() => close(null)}
          />
          <PanelDialog.Body>
            <TextInput label="Name" value={value} onValueChange={setValue} placeholder="e.g. Sales dashboard" required />
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <span />
            <div class="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => close(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => value().trim() && close(value().trim())}>
                Create
              </Button>
            </div>
          </PanelDialog.Footer>
        </PanelDialog>
      );
    }, panelDialogOptions);
    if (name) createMutation.mutate(name);
  };

  return (
    <AppWorkspace.SidebarItem tone="success" disabled={createMutation.loading()} onClick={() => void createApp()}>
      <AppWorkspace.SidebarItemIcon icon={createMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
      <AppWorkspace.SidebarItemLabel>New app</AppWorkspace.SidebarItemLabel>
    </AppWorkspace.SidebarItem>
  );
}
