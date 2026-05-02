import { Index, Show, createMemo } from "solid-js";
import { navigateTo, Select } from "@valentinkolb/cloud/ui";
import type { Field } from "../../service";

export type SortRow = { fieldId: string; direction: "asc" | "desc" };

type Props = {
  fields: Field[];
  /** Controlled rows — owned by GridToolbar. */
  rows: () => SortRow[];
  onRowsChange: (next: SortRow[]) => void;
  initialFromUrl: SortRow[];
  baseUrl: string;
};

export const SORTABLE_TYPES = new Set([
  "text",
  "longtext",
  "number",
  "decimal",
  "rating",
  "autonumber",
  "date",
  "boolean",
  "single-select",
]);

export const sortableFields = (fields: Field[]): Field[] =>
  fields.filter((f) => !f.deletedAt && SORTABLE_TYPES.has(f.type));

const buildSortUrl = (baseUrl: string, rows: SortRow[]): string => {
  const url = new URL(baseUrl, "http://x");
  if (rows.length === 0) {
    url.searchParams.delete("sort");
  } else {
    url.searchParams.set("sort", JSON.stringify(rows));
  }
  url.searchParams.delete("cursor");
  return `${url.pathname}${url.search}`;
};

const isComplete = (row: SortRow, fields: Field[]): boolean =>
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

  const apply = () => {
    const validated = props.rows().filter((r) => isComplete(r, props.fields));
    // Mixed asc/desc are rejected by the compiler (Phase 1B); align everything
    // to the first row's direction so the user gets a working query rather
    // than a 400 on the next cursor request.
    if (validated.length > 1) {
      const first = validated[0]!.direction;
      const allMatch = validated.every((r) => r.direction === first);
      if (!allMatch) {
        for (const r of validated) r.direction = first;
      }
    }
    navigateTo(buildSortUrl(props.baseUrl, validated));
  };

  const updateRow = (index: number, patch: Partial<SortRow>) => {
    props.onRowsChange(props.rows().map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const blank = blankSortRow(props.fields);
    if (blank) props.onRowsChange([...props.rows(), blank]);
  };

  const removeRow = (index: number) => props.onRowsChange(props.rows().filter((_, i) => i !== index));

  const clearAll = () => {
    props.onRowsChange([]);
    navigateTo(buildSortUrl(props.baseUrl, []));
  };

  const dirty = createMemo(() => {
    const a = JSON.stringify(props.initialFromUrl);
    const b = JSON.stringify(props.rows().filter((r) => isComplete(r, props.fields)));
    return a !== b;
  });

  if (fields().length === 0) return null;

  return (
    <div class="flex flex-col gap-1.5">
      <Index each={props.rows()}>
        {(rowSignal, index) => (
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-dimmed">{index === 0 ? "sort by" : "then"}</span>
            <div class="min-w-[10rem]">
              <Select
                value={() => rowSignal().fieldId}
                onChange={(v) => updateRow(index, { fieldId: v })}
                options={fields().map((f) => ({ id: f.id, label: f.name }))}
                placeholder="Field"
              />
            </div>
            <div class="min-w-[8rem]">
              <Select
                value={() => rowSignal().direction}
                onChange={(v) => updateRow(index, { direction: v as "asc" | "desc" })}
                options={[
                  { id: "asc", label: "A → Z" },
                  { id: "desc", label: "Z → A" },
                ]}
              />
            </div>
            <button
              type="button"
              class="text-dimmed hover:text-red-500 px-1"
              onClick={() => removeRow(index)}
              title="Remove sort"
            >
              <i class="ti ti-x" />
            </button>
          </div>
        )}
      </Index>

      <div class="flex items-center gap-2">
        <button type="button" class="btn-input btn-input-sm" onClick={addRow}>
          <i class="ti ti-plus" /> Add sort
        </button>
        <button
          type="button"
          class="btn-input btn-input-sm text-red-500"
          onClick={clearAll}
        >
          <i class="ti ti-x" /> Clear
        </button>
        <Show when={dirty()}>
          <button
            type="button"
            class="btn-input btn-input-sm btn-input-active ml-auto"
            onClick={apply}
            title="Apply sort"
          >
            <i class="ti ti-check" /> Apply
          </button>
        </Show>
      </div>
    </div>
  );
}
