import { Select } from "@valentinkolb/cloud/ui";
import { createMemo, Index, Show } from "solid-js";
import type { Field } from "../../../service";

export type GroupByRow = {
  fieldId: string;
  direction?: "asc" | "desc";
  granularity?: "day" | "week" | "month" | "quarter" | "year";
};

/**
 * Strict-controlled input — three props, no apply / dirty / URL logic.
 * The surrounding GridToolbar handles "commit". Use `isGroupByRowComplete`
 * to validate rows from the outside.
 */
type Props = {
  fields: Field[];
  rows: () => GroupByRow[];
  onRowsChange: (next: GroupByRow[]) => void;
};

/**
 * Field types that produce well-defined group buckets. Mirrors
 * `isGroupable(field)` in `service/group-compiler.ts` — keep them in
 * sync. Lookup / rollup deferred (would require correlated-subquery
 * GROUP BY); select uses explode semantics for one bucket per selected option.
 */
const GROUPABLE_TYPES = new Set([
  "text",
  "longtext",
  "number",
  "percent",
  "duration",
  "autonumber",
  "boolean",
  "date",
  "select",
  "relation",
]);

const groupableFields = (fields: Field[]): Field[] => fields.filter((f) => !f.deletedAt && GROUPABLE_TYPES.has(f.type));

export const blankGroupByRow = (fields: Field[]): GroupByRow | null => {
  const usable = groupableFields(fields);
  const first = usable[0];
  if (!first) return null;
  return { fieldId: first.id, direction: "asc" };
};

export const isGroupByRowComplete = (row: GroupByRow, fields: Field[]): boolean =>
  Boolean(row.fieldId && fields.some((f) => f.id === row.fieldId));

export default function GroupByPanel(props: Props) {
  const fields = createMemo(() => groupableFields(props.fields));
  const fieldsById = createMemo(() => new Map(props.fields.map((f) => [f.id, f])));

  const updateRow = (index: number, patch: Partial<GroupByRow>) => {
    props.onRowsChange(props.rows().map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    if (props.rows().length >= 3) return; // .max(3) at the schema
    const blank = blankGroupByRow(props.fields);
    if (blank) props.onRowsChange([...props.rows(), blank]);
  };

  const removeRow = (index: number) => props.onRowsChange(props.rows().filter((_, i) => i !== index));

  if (fields().length === 0) return null;

  return (
    <div class="flex flex-col gap-1.5">
      <Index each={props.rows()}>
        {(rowSignal, index) => {
          const f = () => fieldsById().get(rowSignal().fieldId);
          const isDate = () => f()?.type === "date";
          return (
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              <span class="w-16 shrink-0 text-dimmed">{index === 0 ? "group by" : "then by"}</span>
              <div class="w-40 shrink-0">
                <Select
                  value={() => rowSignal().fieldId}
                  onChange={(v) => updateRow(index, { fieldId: v })}
                  options={fields().map((fld) => ({ id: fld.id, label: fld.name }))}
                  placeholder="Field"
                />
              </div>
              <div class="w-32 shrink-0">
                <Select
                  value={() => rowSignal().direction ?? "asc"}
                  onChange={(v) => updateRow(index, { direction: v as "asc" | "desc" })}
                  options={[
                    { id: "asc", label: "A → Z" },
                    { id: "desc", label: "Z → A" },
                  ]}
                />
              </div>
              <Show when={isDate()}>
                <div class="w-32 shrink-0">
                  <Select
                    value={() => rowSignal().granularity ?? "day"}
                    onChange={(v) =>
                      updateRow(index, {
                        granularity: v as GroupByRow["granularity"],
                      })
                    }
                    options={[
                      { id: "day", label: "by day" },
                      { id: "week", label: "by week" },
                      { id: "month", label: "by month" },
                      { id: "quarter", label: "by quarter" },
                      { id: "year", label: "by year" },
                    ]}
                  />
                </div>
              </Show>
              <button type="button" class="text-dimmed hover:text-red-500 px-1" onClick={() => removeRow(index)} title="Remove group level">
                <i class="ti ti-x" />
              </button>
            </div>
          );
        }}
      </Index>

      <Show when={props.rows().length < 3}>
        <div class="flex items-center gap-1">
          <button type="button" class="btn-simple btn-sm text-emerald-600 hover:text-emerald-700" onClick={addRow}>
            <i class="ti ti-plus" /> Add
          </button>
        </div>
      </Show>
    </div>
  );
}
