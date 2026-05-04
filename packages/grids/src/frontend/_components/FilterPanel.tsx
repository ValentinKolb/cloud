import { Index, Match, Switch, createMemo } from "solid-js";
import { DateTimeInput, NumberInput, Select, TextInput } from "@valentinkolb/cloud/ui";
import type { Field } from "../../service";
import { filterableFields, opsForType, type FilterOp } from "./filter-ops";

export type FilterLeaf = {
  fieldId: string;
  op: string;
  value?: unknown;
};

/**
 * Strict-controlled input. Three props, no apply / dirty / URL logic —
 * the surrounding GridToolbar (or any other parent) handles "commit
 * this state". The toolbar uses `isFilterLeafComplete` to filter out
 * partial rows when serialising the combined URL.
 */
type Props = {
  fields: Field[];
  rows: () => FilterLeaf[];
  onRowsChange: (next: FilterLeaf[]) => void;
};

/**
 * Predicate exported for callers that want to validate filter leaves
 * outside the panel — e.g. the GridToolbar's "Apply all" chip needs to
 * filter out incomplete rows before serialising the combined URL.
 */
export const isFilterLeafComplete = (leaf: FilterLeaf, fields: Field[]): boolean => {
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

      {/* Bottom row — Add only. Apply is owned by the GridToolbar's
          floating Apply/Cancel chips (one for the whole query state). */}
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn-simple btn-sm text-emerald-600 hover:text-emerald-700"
          onClick={addLeaf}
        >
          <i class="ti ti-plus" /> Add
        </button>
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
 *  - dates: cloud DateTimeInput dateOnly (or NumberInput for lastNDays)
 *  - numbers: cloud NumberInput
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

  return (
    <Switch>
      {/* "none" → render nothing; covered by Switch's no-match fallback. */}

      <Match when={kind() === "range"}>
        {(() => {
          const range = () =>
            Array.isArray(props.value) ? (props.value as [unknown, unknown]) : ["", ""];
          const isDate = () => props.field?.type === "date";
          const numAt = (i: 0 | 1) => {
            const v = range()[i];
            const n = typeof v === "number" ? v : Number(v);
            return Number.isFinite(n) ? n : undefined;
          };
          const dateAt = (i: 0 | 1) => {
            const v = range()[i];
            return typeof v === "string" ? v : "";
          };
          return (
            <span class="flex items-center gap-1">
              <div class="w-44">
                {isDate() ? (
                  <DateTimeInput
                    dateOnly
                    value={() => dateAt(0)}
                    onChange={(v) => props.onChange([v, range()[1]])}
                  />
                ) : (
                  <NumberInput
                    value={() => numAt(0)}
                    onChange={(v) => props.onChange([v, range()[1]])}
                  />
                )}
              </div>
              <span class="text-dimmed">to</span>
              <div class="w-44">
                {isDate() ? (
                  <DateTimeInput
                    dateOnly
                    value={() => dateAt(1)}
                    onChange={(v) => props.onChange([range()[0], v])}
                  />
                ) : (
                  <NumberInput
                    value={() => numAt(1)}
                    onChange={(v) => props.onChange([range()[0], v])}
                  />
                )}
              </div>
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
            onChange={(v) => {
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
        <div class="w-44">
          <NumberInput
            min={1}
            placeholder="days"
            value={() => {
              const v = props.value;
              const n = typeof v === "number" ? v : Number(v);
              return Number.isFinite(n) ? n : undefined;
            }}
            onChange={(v) => props.onChange(v)}
          />
        </div>
      </Match>

      <Match when={kind() === "date"}>
        <div class="w-44">
          <DateTimeInput
            dateOnly
            value={() => (typeof props.value === "string" ? props.value : "")}
            onChange={(v) => props.onChange(v)}
          />
        </div>
      </Match>

      <Match when={kind() === "number"}>
        <div class="w-44">
          <NumberInput
            value={() => {
              const v = props.value;
              const n = typeof v === "number" ? v : Number(v);
              return Number.isFinite(n) ? n : undefined;
            }}
            onChange={(v) => props.onChange(v)}
          />
        </div>
      </Match>

      <Match when={kind() === "text"}>
        <div class="w-44">
          <TextInput
            value={() => (typeof props.value === "string" ? props.value : "")}
            onChange={(v) => props.onChange(v)}
          />
        </div>
      </Match>
    </Switch>
  );
}
