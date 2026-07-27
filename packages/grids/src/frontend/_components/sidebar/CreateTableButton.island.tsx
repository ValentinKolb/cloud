import { AppWorkspace, CheckboxCard, dialogCore, PanelDialog, panelDialogOptions, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import type { Table, TableKind } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

export default function CreateTableButton(props: { baseId: string; baseShortId: string }) {
  const createMutation = mutations.create<Table, { name: string; kind: TableKind }>({
    mutation: async (input) => {
      const res = await apiClient.tables["by-base"][":baseId"].$post({
        param: { baseId: props.baseId },
        json: { name: input.name, kind: input.kind },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create table"));
      return res.json();
    },
    onSuccess: (table) => navigateTo(`/app/grids/${props.baseShortId}/table/${table.shortId}?edit=true`),
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
                onChange={() => setKind("stored")}
              />
              <CheckboxCard
                label="Combined table"
                description="Publish a read-only table that combines mapped fields from other tables."
                icon="ti ti-table-share"
                variant="input"
                value={() => kind() === "federated"}
                onChange={() => setKind("federated")}
              />
              <TextInput label="Name" value={name} onInput={setName} placeholder="e.g. Global inventory" required />
            </PanelDialog.Section>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <span />
            <div class="flex items-center gap-2">
              <button type="button" class="btn-input btn-sm" onClick={() => close(null)}>
                Cancel
              </button>
              <button
                type="button"
                class="btn-primary btn-sm"
                onClick={() => {
                  const trimmed = name().trim();
                  if (trimmed) close({ name: trimmed, kind: kind() });
                }}
              >
                Create
              </button>
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
