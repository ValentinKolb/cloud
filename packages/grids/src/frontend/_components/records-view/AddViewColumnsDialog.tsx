import { dialogCore, MultiSelectInput, PanelDialog, panelDialogOptions } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";

type AddViewColumnOption = {
  id: string;
  label: string;
  description: string;
  icon: string;
};

export const openAddViewColumnsDialog = (columns: AddViewColumnOption[]) =>
  dialogCore.open<string[] | null>((close) => {
    const [selectedColumnIds, setSelectedColumnIds] = createSignal<string[]>([]);
    const addSelected = () => {
      const selected = selectedColumnIds();
      if (selected.length === 0) return;
      close(selected);
    };
    return (
      <PanelDialog>
        <PanelDialog.Header title="Add columns" icon="ti ti-plus" close={() => close(null)} />
        <PanelDialog.Body>
          <MultiSelectInput
            label="Columns"
            description="Choose one or more hidden columns to show."
            placeholder="Choose columns"
            icon="ti ti-columns"
            value={selectedColumnIds}
            onChange={setSelectedColumnIds}
            options={columns}
            clearable
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span />
          <div class="flex items-center gap-2">
            <button type="button" class="btn-simple btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={addSelected} disabled={selectedColumnIds().length === 0}>
              Add columns
            </button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);
