import { DatePicker, DateRangePicker, DateTimePicker, MultiSelectInput, NumberInput, Select, TextInput } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { createMemo, Index, Match, Switch } from "solid-js";
import type { Field } from "../../../service";
import RelationPicker from "../records/RelationPicker";
import { type FilterOp, filterableFields, opsForType } from "./filter-ops";

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
  dateConfig?: DateContext;
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
  if (Array.isArray(leaf.value) && leaf.value.length === 0) return false;
  if (op.needsRange) {
    return Array.isArray(leaf.value) && leaf.value.length === 2 && leaf.value.every((v) => v !== "" && v != null);
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
              <span class="w-12 shrink-0 text-dimmed">{index === 0 ? "where" : "and"}</span>
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
                dateConfig={props.dateConfig}
              />

              <button type="button" class="text-dimmed hover:text-red-500 px-1" onClick={() => removeLeaf(index)} title="Remove filter">
                <i class="ti ti-x" />
              </button>
            </div>
          );
        }}
      </Index>

      {/* Bottom row — Add only. Apply is owned by the GridToolbar's
          floating Apply/Cancel chips (one for the whole query state). */}
      <div class="flex items-center gap-1">
        <button type="button" class="btn-simple btn-sm text-emerald-600 hover:text-emerald-700" onClick={addLeaf}>
          <i class="ti ti-plus" /> Add
        </button>
      </div>
    </div>
  );
}

type ValueKind = "none" | "range" | "select" | "multi" | "boolean" | "relation" | "number-days" | "date" | "number" | "text";

/**
 * Renders the right-hand value input for a filter row, type-aware:
 *  - ops with `needsValue=false` (empty, not empty, today, …): NOTHING
 *  - ops with `needsRange=true` (between): TWO inputs side-by-side
 *  - boolean fields: cloud Select
 *  - select fields (is / isNot): cloud Select over field options
 *  - select multi-value ops (one-of / none-of): MultiSelectInput
 *  - relation contains: RelationPicker over the target table
 *  - dates: cloud DatePicker / DateTimePicker (or NumberInput for lastNDays)
 *  - numeric fields: cloud NumberInput
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
  dateConfig?: DateContext;
}) {
  const kind = createMemo<ValueKind>(() => {
    const field = props.field;
    const op = props.op;
    if (!field || !op || !op.needsValue) return "none";
    if (op.needsRange) return "range";
    if (field.type === "select" && (op.id === "is" || op.id === "isNot")) {
      return "select";
    }
    if (op.id === "isAnyOf" || op.id === "isNoneOf") {
      return "multi";
    }
    if (field.type === "boolean") return "boolean";
    if (field.type === "relation" && op.id === "containsAny") return "relation";
    if (field.type === "date" && op.id === "lastNDays") return "number-days";
    if (field.type === "date") return "date";
    if (field.type === "number" || field.type === "autonumber" || field.type === "percent" || field.type === "duration") {
      return "number";
    }
    return "text";
  });

  return (
    <Switch>
      {/* "none" → render nothing; covered by Switch's no-match fallback. */}

      <Match when={kind() === "range"}>
        {(() => {
          const range = () => (Array.isArray(props.value) ? (props.value as [unknown, unknown]) : ["", ""]);
          const isDate = () => props.field?.type === "date";
          const includeTime = () => Boolean((props.field?.config as { includeTime?: boolean } | undefined)?.includeTime);
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
              {isDate() ? (
                <div class="w-80">
                  <DateRangePicker
                    withTime={includeTime()}
                    dateConfig={props.dateConfig}
                    value={() => ({ start: dateAt(0) || null, end: dateAt(1) || null })}
                    onChange={(v) => props.onChange([v.start ?? "", v.end ?? ""])}
                    clearable
                  />
                </div>
              ) : (
                <>
                  <div class="w-44">
                    <NumberInput value={() => numAt(0)} onChange={(v) => props.onChange([v, range()[1]])} decimalPlaces={10} />
                  </div>
                  <span class="text-dimmed">to</span>
                  <div class="w-44">
                    <NumberInput value={() => numAt(1)} onChange={(v) => props.onChange([range()[0], v])} decimalPlaces={10} />
                  </div>
                </>
              )}
            </span>
          );
        })()}
      </Match>

      <Match when={kind() === "select"}>
        <div class="w-44">
          <Select
            value={() => (typeof props.value === "string" ? props.value : "")}
            onChange={(v) => props.onChange(v)}
            options={((props.field?.config as { options?: Array<{ id: string; label: string; description?: string }> })?.options ?? []).map(
              (o) => ({ id: o.id, label: o.label, description: o.description }),
            )}
            placeholder="—"
          />
        </div>
      </Match>

      <Match when={kind() === "multi"}>
        <div class="w-72">
          <MultiSelectInput
            placeholder="Options"
            value={() => (Array.isArray(props.value) ? props.value.filter((item): item is string => typeof item === "string") : [])}
            onChange={(value) => props.onChange(value)}
            options={(
              (
                props.field?.config as
                  | { options?: Array<{ id: string; label: string; description?: string; icon?: string; color?: string }> }
                  | undefined
              )?.options ?? []
            ).map((option) => ({
              id: option.id,
              label: option.label,
              description: option.description,
              icon: option.icon,
              color: option.color,
            }))}
            clearable
          />
        </div>
      </Match>

      <Match when={kind() === "boolean"}>
        <div class="w-32">
          <Select
            value={() => (props.value === true ? "true" : props.value === false ? "false" : "")}
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

      <Match when={kind() === "relation"}>
        <div class="w-64">
          {(() => {
            const targetTableId = (props.field?.config as { targetTableId?: string } | undefined)?.targetTableId;
            if (!targetTableId) return <span class="text-xs text-amber-600 dark:text-amber-400">Pick a target table first.</span>;
            return (
              <RelationPicker
                targetTableId={targetTableId}
                value={() => (Array.isArray(props.value) ? (props.value as string[]) : [])}
                labels={() => ({})}
                multi
                onChange={(v) => props.onChange(v)}
              />
            );
          })()}
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
          {(() => {
            const includeTime = () => Boolean((props.field?.config as { includeTime?: boolean } | undefined)?.includeTime);
            const value = () => (typeof props.value === "string" && props.value ? props.value : null);
            const onChange = (v: string | null) => props.onChange(v ?? "");
            return includeTime() ? (
              <DateTimePicker dateConfig={props.dateConfig} value={value} onChange={onChange} clearable />
            ) : (
              <DatePicker dateConfig={props.dateConfig} value={value} onChange={onChange} clearable />
            );
          })()}
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
            decimalPlaces={10}
          />
        </div>
      </Match>

      <Match when={kind() === "text"}>
        <div class="w-44">
          <TextInput value={() => (typeof props.value === "string" ? props.value : "")} onChange={(v) => props.onChange(v)} />
        </div>
      </Match>
    </Switch>
  );
}
