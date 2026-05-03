import { Index, Match, Show, Switch, createMemo } from "solid-js";
import { navigateTo, Select, TextInput } from "@valentinkolb/cloud/ui";
import type { Field } from "../../service";
import { filterableFields, opsForType, type FilterOp } from "./filter-ops";

export type FilterLeaf = {
  fieldId: string;
  op: string;
  value?: unknown;
};

type Props = {
  fields: Field[];
  /** Controlled row state — owned by the parent so it can derive the
   *  panel's visibility from `rows.length > 0`. */
  rows: () => FilterLeaf[];
  onRowsChange: (next: FilterLeaf[]) => void;
  /** Filter currently committed (URL state OR persisted view config) —
   *  used for the "dirty" check that gates the Apply button. */
  initialFromUrl: FilterLeaf[];
  /** Base URL — used by the default Apply behavior to navigate with the
   *  serialized filter. Required when `onApply` is not set. */
  baseUrl?: string;
  /** When set, Apply calls this with the validated leaves instead of
   *  navigating. Use this to wire the panel into a settings page that
   *  persists into a view's config rather than the URL. */
  onApply?: (leaves: FilterLeaf[]) => void;
};

const buildFilterUrl = (baseUrl: string, leaves: FilterLeaf[]): string => {
  const url = new URL(baseUrl, "http://x");
  if (leaves.length === 0) {
    url.searchParams.delete("filter");
    url.searchParams.delete("cursor");
  } else {
    const tree = { op: "AND" as const, filters: leaves };
    url.searchParams.set("filter", JSON.stringify(tree));
    url.searchParams.delete("cursor");
  }
  return `${url.pathname}${url.search}`;
};

const isComplete = (leaf: FilterLeaf, fields: Field[]): boolean => {
  const field = fields.find((f) => f.id === leaf.fieldId);
  if (!field) return false;
  const op = opsForType(field.type).find((o) => o.id === leaf.op);
  if (!op) return false;
  if (!op.needsValue) return true;
  if (leaf.value === undefined || leaf.value === "" || leaf.value === null) return false;
  if (op.needsRange) {
    return (
      Array.isArray(leaf.value) &&
      leaf.value.length === 2 &&
      leaf.value.every((v) => v !== "" && v != null)
    );
  }
  return true;
};

/** Build a blank filter leaf for the first available field/op pair. */
export const blankLeaf = (fields: Field[]): FilterLeaf | null => {
  const usable = filterableFields(fields);
  const first = usable[0];
  if (!first) return null;
  const ops = opsForType(first.type);
  return { fieldId: first.id, op: ops[0]?.id ?? "", value: "" };
};

export default function FilterPanel(props: Props) {
  const fields = createMemo(() => filterableFields(props.fields));

  const apply = () => {
    const validated = props.rows().filter((l) => isComplete(l, props.fields));
    if (props.onApply) {
      props.onApply(validated);
      return;
    }
    if (props.baseUrl) navigateTo(buildFilterUrl(props.baseUrl, validated));
  };

  const updateLeaf = (index: number, patch: Partial<FilterLeaf>) => {
    const next = props.rows().map((l, i) => (i === index ? { ...l, ...patch } : l));
    // Field change → reset op to first valid op for new type
    if (patch.fieldId !== undefined) {
      const field = props.fields.find((f) => f.id === patch.fieldId);
      if (field) {
        const ops = opsForType(field.type);
        next[index] = { ...next[index]!, op: ops[0]?.id ?? "", value: "" };
      }
    }
    props.onRowsChange(next);
  };

  const addLeaf = () => {
    const blank = blankLeaf(props.fields);
    if (blank) props.onRowsChange([...props.rows(), blank]);
  };
  const removeLeaf = (index: number) => props.onRowsChange(props.rows().filter((_, i) => i !== index));

  const dirty = createMemo(() => {
    const a = JSON.stringify(props.initialFromUrl);
    const b = JSON.stringify(props.rows().filter((l) => isComplete(l, props.fields)));
    return a !== b;
  });

  if (fields().length === 0) return null;

  return (
    <div class="flex flex-col gap-1.5">
      {/*
        Index (not For) so editing a row's value doesn't replace the
        outer row object → For would unmount the input mid-keystroke.
      */}
      <Index each={props.rows()}>
        {(leafSignal, index) => {
          const leaf = leafSignal;
          const field = createMemo(() => props.fields.find((f) => f.id === leaf().fieldId) ?? null);
          const ops = createMemo<FilterOp[]>(() => (field() ? opsForType(field()!.type) : []));
          const op = createMemo<FilterOp | null>(() => ops().find((o) => o.id === leaf().op) ?? null);

          return (
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              {/* Fixed-width label so all rows align: "where" (5 chars)
                  and "and" (3 chars) sit in the same column → the field
                  Select below stays vertically aligned across rows. */}
              <span class="w-12 shrink-0 text-dimmed">
                {index === 0 ? "where" : "and"}
              </span>
              <div class="w-40 shrink-0">
                <Select
                  value={() => leaf().fieldId}
                  onChange={(v) => updateLeaf(index, { fieldId: v })}
                  options={fields().map((f) => ({ id: f.id, label: f.name }))}
                  placeholder="Field"
                />
              </div>
              <div class="w-40 shrink-0">
                <Select
                  value={() => leaf().op}
                  onChange={(v) => updateLeaf(index, { op: v, value: "" })}
                  options={ops().map((o) => ({ id: o.id, label: o.label }))}
                  placeholder="Operator"
                />
              </div>

              <FilterValueInput
                field={field()}
                op={op()}
                value={leaf().value}
                onChange={(v) => updateLeaf(index, { value: v })}
              />

              <button
                type="button"
                class="text-dimmed hover:text-red-500 px-1"
                onClick={() => removeLeaf(index)}
                title="Remove filter"
              >
                <i class="ti ti-x" />
              </button>
            </div>
          );
        }}
      </Index>

      {/* Bottom row — only Add + (conditional) Apply. The toolbar's
          smart-Clear chip handles bulk-clear globally; per-panel Cancel
          felt redundant. */}
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn-simple btn-sm text-emerald-600 hover:text-emerald-700"
          onClick={addLeaf}
        >
          <i class="ti ti-plus" /> Add
        </button>
        <Show when={dirty()}>
          <button
            type="button"
            class="btn-input btn-input-sm btn-input-active ml-auto"
            onClick={apply}
            title="Apply filter"
          >
            <i class="ti ti-check" /> Apply
          </button>
        </Show>
      </div>
    </div>
  );
}

type ValueKind =
  | "none"
  | "range"
  | "select"
  | "multi"
  | "boolean"
  | "number-days"
  | "date"
  | "number"
  | "text";

/**
 * Renders the right-hand value input for a filter row, type-aware:
 *  - ops with `needsValue=false` (empty, not empty, today, …): NOTHING
 *  - ops with `needsRange=true` (between): TWO inputs side-by-side
 *  - boolean fields: cloud Select
 *  - single-select fields (is / isNot): cloud Select over field options
 *  - any multi-value op (any-of / none-of / all-of / not-contains): TextInput
 *    (comma-separated → parsed to a string[] on input)
 *  - dates: native `<input type=date>` (or number for lastNDays)
 *  - numbers: native `<input type=number>` (keeps spinner widget)
 *  - text-shaped fallback: cloud TextInput
 *
 * IMPORTANT: this component is REACTIVE by way of Switch/Match — destructuring
 * `props.op` at the function body level captures a stale value and the input
 * fails to switch when the user picks a different operator (e.g. "empty" still
 * shows a text box). Always read `props.op` / `props.field` from inside JSX
 * or memos; never bind them to const at the top.
 */
function FilterValueInput(props: {
  field: Field | null;
  op: FilterOp | null;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const kind = createMemo<ValueKind>(() => {
    const field = props.field;
    const op = props.op;
    if (!field || !op || !op.needsValue) return "none";
    if (op.needsRange) return "range";
    if (field.type === "single-select" && (op.id === "is" || op.id === "isNot")) {
      return "select";
    }
    if (
      op.id === "isAnyOf" ||
      op.id === "isNoneOf" ||
      op.id === "containsAll" ||
      op.id === "containsAny" ||
      op.id === "doesNotContain"
    ) {
      return "multi";
    }
    if (field.type === "boolean") return "boolean";
    if (field.type === "date" && op.id === "lastNDays") return "number-days";
    if (field.type === "date") return "date";
    if (
      field.type === "number" ||
      field.type === "decimal" ||
      field.type === "rating" ||
      field.type === "autonumber"
    ) {
      return "number";
    }
    return "text";
  });

  const nativeClass =
    "rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-xs w-44";

  return (
    <Switch>
      {/* "none" → render nothing; covered by Switch's no-match fallback. */}

      <Match when={kind() === "range"}>
        {(() => {
          const range = () =>
            Array.isArray(props.value) ? (props.value as [unknown, unknown]) : ["", ""];
          const inputType = () => (props.field?.type === "date" ? "date" : "number");
          return (
            <span class="flex items-center gap-1">
              <input
                type={inputType()}
                class={nativeClass}
                value={range()[0] != null ? String(range()[0]) : ""}
                onInput={(e) => props.onChange([e.currentTarget.value, range()[1]])}
              />
              <span class="text-dimmed">to</span>
              <input
                type={inputType()}
                class={nativeClass}
                value={range()[1] != null ? String(range()[1]) : ""}
                onInput={(e) => props.onChange([range()[0], e.currentTarget.value])}
              />
            </span>
          );
        })()}
      </Match>

      <Match when={kind() === "select"}>
        <div class="w-44">
          <Select
            value={() => (typeof props.value === "string" ? props.value : "")}
            onChange={(v) => props.onChange(v)}
            options={
              ((props.field?.config as { options?: Array<{ id: string; label: string }> })
                ?.options ?? []
              ).map((o) => ({ id: o.id, label: o.label }))
            }
            placeholder="—"
          />
        </div>
      </Match>

      <Match when={kind() === "multi"}>
        <div class="w-44">
          <TextInput
            icon="ti ti-list"
            placeholder="comma-separated"
            value={() =>
              Array.isArray(props.value) ? props.value.join(", ") : String(props.value ?? "")
            }
            onInput={(v) => {
              const parts = v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              props.onChange(parts);
            }}
          />
        </div>
      </Match>

      <Match when={kind() === "boolean"}>
        <div class="w-32">
          <Select
            value={() =>
              props.value === true ? "true" : props.value === false ? "false" : ""
            }
            onChange={(v) => props.onChange(v === "" ? "" : v === "true")}
            options={[
              { id: "true", label: "true" },
              { id: "false", label: "false" },
            ]}
            placeholder="—"
            clearable
          />
        </div>
      </Match>

      <Match when={kind() === "number-days"}>
        <input
          type="number"
          min="1"
          class={nativeClass}
          placeholder="days"
          value={
            typeof props.value === "number" || typeof props.value === "string"
              ? String(props.value)
              : ""
          }
          onInput={(e) => {
            const n = e.currentTarget.valueAsNumber;
            props.onChange(Number.isFinite(n) ? n : e.currentTarget.value);
          }}
        />
      </Match>

      <Match when={kind() === "date"}>
        <input
          type="date"
          class={nativeClass}
          value={typeof props.value === "string" ? props.value : ""}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      </Match>

      <Match when={kind() === "number"}>
        <input
          type="number"
          class={nativeClass}
          value={
            typeof props.value === "number" || typeof props.value === "string"
              ? String(props.value)
              : ""
          }
          onInput={(e) => {
            const n = e.currentTarget.valueAsNumber;
            props.onChange(Number.isFinite(n) ? n : e.currentTarget.value);
          }}
        />
      </Match>

      <Match when={kind() === "text"}>
        <div class="w-44">
          <TextInput
            value={() => (typeof props.value === "string" ? props.value : "")}
            onInput={(v) => props.onChange(v)}
          />
        </div>
      </Match>
    </Switch>
  );
}
