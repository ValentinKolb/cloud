import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { AppWorkspace, Button, CheckboxCard, dialogCore, PanelDialog, panelDialogOptions, prompts, TextInput } from "@k2b/ui";
import { createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import type { PublicTable } from "../../../api/public-dto";
import type { TableKind } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

export default function CreateTableButton(props: { baseId: string }) {
  const createMutation = mutations.create<PublicTable, { name: string; kind: TableKind }>({
    mutation: async (input) => {
      const res = await apiClient.tables["by-base"][":baseId"].$post({
        param: { baseId: props.baseId },
        json: { name: input.name, kind: input.kind },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create table"));
      return res.json();
    },
    onSuccess: (table) => navigateTo(`/app/grids/${props.baseId}/table/${table.id}?edit=true`),
    onError: (e) => prompts.error(e.message),
  });

  const handleClick = async () => {
    const result = await dialogCore.open<{ name: string; kind: TableKind } | null>((close) => {
      const [name, setName] = createSignal("");
      const [kind, setKind] = createSignal<TableKind>("stored");
      return (
        <PanelDialog>
          <PanelDialog.Header title="New table" icon="ti ti-table-plus" close={() => close(null)} />
          <PanelDialog.Body>
            <PanelDialog.Section title="Table type" subtitle="Choose where this table reads its records." icon="ti ti-database">
              <CheckboxCard
                label="Stored table"
                description="Create and edit records directly in this table."
                icon="ti ti-table"
                variant="input"
                value={() => kind() === "stored"}
                onValueChange={() => setKind("stored")}
              />
              <CheckboxCard
                label="Combined table"
                description="Publish a read-only table that combines mapped fields from other tables."
                icon="ti ti-table-share"
                variant="input"
                value={() => kind() === "federated"}
                onValueChange={() => setKind("federated")}
              />
              <TextInput label="Name" value={name} onValueChange={setName} placeholder="e.g. Global inventory" required />
            </PanelDialog.Section>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <span />
            <div class="flex items-center gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => close(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                onClick={() => {
                  const trimmed = name().trim();
                  if (trimmed) close({ name: trimmed, kind: kind() });
                }}
              >
                Create
              </Button>
            </div>
          </PanelDialog.Footer>
        </PanelDialog>
      );
    }, panelDialogOptions);
    if (!result) return;
    createMutation.mutate(result);
  };

  return (
    <AppWorkspace.SidebarItem tone="success" disabled={createMutation.loading()} onClick={() => void handleClick()}>
      <AppWorkspace.SidebarItemIcon icon={createMutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
      <AppWorkspace.SidebarItemLabel>New table</AppWorkspace.SidebarItemLabel>
    </AppWorkspace.SidebarItem>
  );
}
