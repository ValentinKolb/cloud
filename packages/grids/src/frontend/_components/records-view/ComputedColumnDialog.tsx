import { dialogCore, PanelDialog, panelDialogOptions, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { createSignal, Show } from "solid-js";
import type { ColumnSpec } from "../../../contracts";
import type { Field } from "../../../service";
import { FormulaExpressionEditor } from "../fields/FormulaExpressionEditor";

type ComputedColumn = Extract<ColumnSpec, { kind: "computed" }>;

type ComputedColumnDialogResult = { action: "save"; column: ComputedColumn } | { action: "delete" };

const randomComputedColumnId = (): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `computed_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
};

export const openComputedColumnDialog = (args: {
  fields: Field[];
  currentTableId: string;
  baseShortId: string;
  tableShortId: string;
  column?: ComputedColumn;
}) =>
  dialogCore.open<ComputedColumnDialogResult | null>((close) => {
    const [label, setLabel] = createSignal(args.column?.label ?? "");
    const [expression, setExpression] = createSignal(args.column?.expression ?? "");
    const save = () => {
      const nextLabel = label().trim();
      const nextExpression = expression().trim();
      if (!nextLabel) {
        prompts.error("Name is required");
        return;
      }
      if (!nextExpression) {
        prompts.error("Expression is required");
        return;
      }
      close({
        action: "save",
        column: {
          kind: "computed",
          id: args.column?.id ?? randomComputedColumnId(),
          label: nextLabel,
          expression: nextExpression,
          ...(args.column?.format ? { format: args.column.format } : {}),
        },
      });
    };
    return (
      <PanelDialog>
        <PanelDialog.Header
          title={args.column ? "Edit computed column" : "Computed column"}
          icon="ti ti-calculator"
          close={() => close(null)}
        />
        <PanelDialog.Body>
          <div class="info-block-info text-xs">
            Computed columns are view-only. They recalculate from the current row whenever the table is read and are saved with the view
            setup.
          </div>
          <TextInput label="Name" value={label} onInput={setLabel} icon="ti ti-typography" placeholder="e.g. Total with VAT" required />
          <FormulaExpressionEditor
            value={expression}
            onInput={setExpression}
            fields={args.fields}
            currentTableId={args.currentTableId}
            baseShortId={args.baseShortId}
            tableShortId={args.tableShortId}
            ariaLabel="Computed column expression"
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <Show when={args.column} fallback={<span />}>
            <button type="button" class="btn-danger btn-sm" onClick={() => close({ action: "delete" })}>
              <i class="ti ti-trash" /> Delete column
            </button>
          </Show>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-simple btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={save}>
              Save
            </button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);
