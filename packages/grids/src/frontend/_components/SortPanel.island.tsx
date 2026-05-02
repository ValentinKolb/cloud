import { Index, Show, createSignal, createMemo } from "solid-js";
import { navigateTo, Select } from "@valentinkolb/cloud/ui";
import type { Field } from "../../service";

export type SortRow = { fieldId: string; direction: "asc" | "desc" };

type Props = {
  fields: Field[];
  initial: SortRow[];
  baseUrl: string;
};

const SORTABLE_TYPES = new Set([
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

const sortableFields = (fields: Field[]): Field[] =>
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

export default function SortPanel(props: Props) {
  const [rows, setRows] = createSignal<SortRow[]>(props.initial);
  const fields = createMemo(() => sortableFields(props.fields));

  const apply = () => {
    const validated = rows().filter((r) => isComplete(r, props.fields));
    // Mixed asc/desc are rejected by the compiler (Phase 1B); strip down to
    // the first row's direction so the user gets a useful error when they
    // hit Apply with a bad combo, rather than a successful first-page that
    // 400s on the next cursor request.
    if (validated.length > 1) {
      const first = validated[0]!.direction;
      const allMatch = validated.every((r) => r.direction === first);
      if (!allMatch) {
        // Soft fix: align everything to the first direction. Mirror the
        // compiler's stance until nested keyset paging is built.
        for (const r of validated) r.direction = first;
      }
    }
    navigateTo(buildSortUrl(props.baseUrl, validated));
  };

  const updateRow = (index: number, patch: Partial<SortRow>) => {
    setRows(rows().map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const first = fields()[0];
    if (!first) return;
    setRows([...rows(), { fieldId: first.id, direction: "asc" }]);
  };

  const removeRow = (index: number) => setRows(rows().filter((_, i) => i !== index));

  const clearAll = () => {
    setRows([]);
    navigateTo(buildSortUrl(props.baseUrl, []));
  };

  const dirty = createMemo(() => {
    const a = JSON.stringify(props.initial);
    const b = JSON.stringify(rows().filter((r) => isComplete(r, props.fields)));
    return a !== b;
  });

  if (fields().length === 0) return null;

  return (
    <Show
      when={rows().length > 0}
      fallback={
        <button type="button" class="btn-simple btn-sm text-xs text-dimmed" onClick={addRow}>
          <i class="ti ti-arrows-sort" /> Add sort
        </button>
      }
    >
      <div class="flex flex-col gap-1.5">
        {/* Index keeps the DOM stable across edits — see FilterPanel comment. */}
        <Index each={rows()}>
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
          <button type="button" class="btn-simple btn-sm text-xs text-dimmed" onClick={addRow}>
            <i class="ti ti-plus" /> Add sort
          </button>
          <button
            type="button"
            class="btn-simple btn-sm text-xs text-red-500 hover:text-red-600"
            onClick={clearAll}
          >
            <i class="ti ti-x" /> Clear
          </button>
          <Show when={dirty()}>
            <button
              type="button"
              class="btn-primary btn-sm text-xs ml-auto"
              onClick={apply}
              title="Apply sort"
            >
              <i class="ti ti-check" /> Apply
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
