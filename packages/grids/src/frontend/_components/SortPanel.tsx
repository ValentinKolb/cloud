import { Select } from "@valentinkolb/cloud/ui";
import { createMemo, Index } from "solid-js";
import type { Field } from "../../service";

export type SortRow = { fieldId: string; direction: "asc" | "desc" };

/**
 * Strict-controlled input — three props, no apply / dirty / URL logic.
 * The surrounding GridToolbar handles "commit". Use `isSortRowComplete`
 * to validate rows from the outside.
 */
type Props = {
  fields: Field[];
  rows: () => SortRow[];
  onRowsChange: (next: SortRow[]) => void;
};

export const SORTABLE_TYPES = new Set(["text", "longtext", "number", "decimal", "autonumber", "date", "boolean"]);

export const sortableFields = (fields: Field[]): Field[] => fields.filter((f) => !f.deletedAt && SORTABLE_TYPES.has(f.type));

export const isSortRowComplete = (row: SortRow, fields: Field[]): boolean =>
  Boolean(row.fieldId && fields.some((f) => f.id === row.fieldId));

/** Build a blank sort row for the first sortable field. */
export const blankSortRow = (fields: Field[]): SortRow | null => {
  const usable = sortableFields(fields);
  const first = usable[0];
  if (!first) return null;
  return { fieldId: first.id, direction: "asc" };
};

export default function SortPanel(props: Props) {
  const fields = createMemo(() => sortableFields(props.fields));

  const updateRow = (index: number, patch: Partial<SortRow>) => {
    props.onRowsChange(props.rows().map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const blank = blankSortRow(props.fields);
    if (blank) props.onRowsChange([...props.rows(), blank]);
  };

  const removeRow = (index: number) => props.onRowsChange(props.rows().filter((_, i) => i !== index));

  if (fields().length === 0) return null;

  return (
    <div class="flex flex-col gap-1.5">
      <Index each={props.rows()}>
        {(rowSignal, index) => (
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            {/* Fixed-width label keeps "sort by" / "then" in the same column. */}
            <span class="w-12 shrink-0 text-dimmed">{index === 0 ? "sort" : "then"}</span>
            <div class="w-40 shrink-0">
              <Select
                value={() => rowSignal().fieldId}
                onChange={(v) => updateRow(index, { fieldId: v })}
                options={fields().map((f) => ({ id: f.id, label: f.name }))}
                placeholder="Field"
              />
            </div>
            <div class="w-32 shrink-0">
              <Select
                value={() => rowSignal().direction}
                onChange={(v) => updateRow(index, { direction: v as "asc" | "desc" })}
                options={[
                  { id: "asc", label: "A → Z" },
                  { id: "desc", label: "Z → A" },
                ]}
              />
            </div>
            <button type="button" class="text-dimmed hover:text-red-500 px-1" onClick={() => removeRow(index)} title="Remove sort">
              <i class="ti ti-x" />
            </button>
          </div>
        )}
      </Index>

      <div class="flex items-center gap-1">
        <button type="button" class="btn-simple btn-sm text-emerald-600 hover:text-emerald-700" onClick={addRow}>
          <i class="ti ti-plus" /> Add
        </button>
      </div>
    </div>
  );
}
