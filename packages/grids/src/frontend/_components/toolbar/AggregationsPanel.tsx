import { Select, TextInput } from "@valentinkolb/cloud/ui";
import { createMemo, Index } from "solid-js";
import type { Field } from "../../../service";
import { fieldOption } from "../fields/field-type-meta";

export type AggKindUI = "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max";

export type AggregationRow = {
  /** "*" is shorthand for COUNT(*) — count of records in the bucket. */
  fieldId: string | "*";
  agg: AggKindUI;
  /** Optional column header override. When set, the GroupedTable header
   *  uses this verbatim instead of `<agg> <fieldName>`. Letting users
   *  pick "Revenue" instead of "sum price" is a small but valuable
   *  ergonomics win. */
  label?: string;
};

/**
 * Strict-controlled input — three props, no apply / dirty / URL logic.
 * The surrounding GridToolbar handles "commit". Use
 * `isAggregationRowComplete` to validate rows from the outside.
 */
type Props = {
  fields: Field[];
  rows: () => AggregationRow[];
  onRowsChange: (next: AggregationRow[]) => void;
};

const NUMERIC_TYPES = new Set(["number", "percent", "duration"]);
const DATE_TYPES = new Set(["date"]);

/** Aggs that can be applied to a given field. Mirrors `isAggregatable`
 *  in `service/group-compiler.ts` — keep them in sync. */
const aggsForField = (f: Field | null): AggKindUI[] => {
  if (!f) return ["count"]; // "*" only supports count
  const out: AggKindUI[] = ["count", "countEmpty", "countUnique"];
  if (NUMERIC_TYPES.has(f.type)) out.push("sum", "avg", "min", "max");
  else if (DATE_TYPES.has(f.type) || f.type === "text" || f.type === "longtext") out.push("min", "max");
  return out;
};

const AGG_LABELS: Record<AggKindUI, string> = {
  count: "count",
  countEmpty: "count empty",
  countUnique: "count unique",
  sum: "sum",
  avg: "average",
  min: "min",
  max: "max",
};

const AGG_META: Record<AggKindUI, { description: string; icon: string }> = {
  count: { description: "Records with a value", icon: "ti ti-hash" },
  countEmpty: { description: "Records without a value", icon: "ti ti-circle-dashed" },
  countUnique: { description: "Distinct values", icon: "ti ti-fingerprint" },
  sum: { description: "Total value", icon: "ti ti-sum" },
  avg: { description: "Mean value", icon: "ti ti-divide" },
  min: { description: "Smallest value", icon: "ti ti-arrow-down" },
  max: { description: "Largest value", icon: "ti ti-arrow-up" },
};

/** Per-field-type readability — exclude relation/lookup/rollup which
 *  the compiler can't aggregate well; include "*" as a special record-
 *  count entry. */
const aggregatableFields = (fields: Field[]): Field[] =>
  fields.filter(
    (f) => !f.deletedAt && f.type !== "relation" && f.type !== "lookup" && f.type !== "rollup" && f.type !== "formula" && f.type !== "json",
  );

const blankAggregationRow = (): AggregationRow => ({
  fieldId: "*",
  agg: "count",
});

export const isAggregationRowComplete = (row: AggregationRow): boolean => Boolean(row.fieldId && row.agg);

export default function AggregationsPanel(props: Props) {
  const eligibleFields = createMemo(() => aggregatableFields(props.fields));
  const fieldsById = createMemo(() => new Map(props.fields.map((f) => [f.id, f])));

  const updateRow = (index: number, patch: Partial<AggregationRow>) => {
    props.onRowsChange(props.rows().map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => props.onRowsChange([...props.rows(), blankAggregationRow()]);

  const removeRow = (index: number) => props.onRowsChange(props.rows().filter((_, i) => i !== index));

  return (
    <div class="flex flex-col gap-1.5">
      <Index each={props.rows()}>
        {(rowSignal, index) => {
          const fld = () => (rowSignal().fieldId === "*" ? null : (fieldsById().get(rowSignal().fieldId as string) ?? null));
          const aggOptions = createMemo(() =>
            aggsForField(fld()).map((k) => ({ id: k, label: AGG_LABELS[k], description: AGG_META[k].description, icon: AGG_META[k].icon })),
          );
          return (
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              <div class="w-64 shrink-0">
                <Select
                  value={() => rowSignal().fieldId}
                  onChange={(v) => {
                    // Switching field may invalidate the agg — reset to count.
                    updateRow(index, { fieldId: v, agg: "count" });
                  }}
                  options={[
                    { id: "*", label: "All records", description: "Count rows in each group", icon: "ti ti-database" },
                    ...eligibleFields().map((f) => ({
                      ...fieldOption(f),
                    })),
                  ]}
                  placeholder="Field"
                />
              </div>
              <div class="w-56 shrink-0">
                <Select value={() => rowSignal().agg} onChange={(v) => updateRow(index, { agg: v as AggKindUI })} options={aggOptions()} />
              </div>
              <div class="w-64 shrink-0">
                {/* Optional column-header override. Empty → renderer uses
                    the auto-derived "<agg> <fieldName>" string. */}
                <TextInput
                  value={() => rowSignal().label ?? ""}
                  onChange={(v) =>
                    updateRow(index, {
                      label: v.trim() === "" ? undefined : v,
                    })
                  }
                  placeholder="Column label"
                />
              </div>
              <button type="button" class="text-dimmed hover:text-red-500 px-1" onClick={() => removeRow(index)} title="Remove aggregation">
                <i class="ti ti-x" />
              </button>
            </div>
          );
        }}
      </Index>

      <div class="flex items-center gap-1">
        <button type="button" class="btn-input-success btn-input-sm" onClick={addRow}>
          <i class="ti ti-plus" /> Add
        </button>
      </div>
    </div>
  );
}
