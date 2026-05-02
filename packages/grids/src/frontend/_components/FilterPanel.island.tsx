import { For, Show, createSignal, createMemo } from "solid-js";
import { navigateTo } from "@valentinkolb/cloud/ui";
import type { Field } from "../../service";
import { filterableFields, opsForType, type FilterOp } from "./filter-ops";

export type FilterLeaf = {
  fieldId: string;
  op: string;
  value?: unknown;
};

type Props = {
  fields: Field[];
  /** Initial filter rows, parsed from URL `?filter=<json>`. */
  initial: FilterLeaf[];
  /** Base URL without the filter param — clicking apply navigates to
   *  `${baseUrl}{&|?}filter=<json>` (with `?` if no `?` already present). */
  baseUrl: string;
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

const blankLeaf = (fields: Field[]): FilterLeaf => {
  const first = fields[0];
  if (!first) return { fieldId: "", op: "", value: "" };
  const ops = opsForType(first.type);
  return { fieldId: first.id, op: ops[0]?.id ?? "", value: "" };
};

const isComplete = (
  leaf: FilterLeaf,
  fields: Field[],
): boolean => {
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

export default function FilterPanel(props: Props) {
  // Local state so users can build a filter row without each keystroke
  // bouncing through a full SSR round-trip. Apply commits to the URL.
  const [leaves, setLeaves] = createSignal<FilterLeaf[]>(props.initial);
  const fields = createMemo(() => filterableFields(props.fields));

  const apply = () => {
    const validated = leaves().filter((l) => isComplete(l, props.fields));
    navigateTo(buildFilterUrl(props.baseUrl, validated));
  };

  const updateLeaf = (index: number, patch: Partial<FilterLeaf>) => {
    const next = leaves().map((l, i) => (i === index ? { ...l, ...patch } : l));
    // Field change → reset op to first valid op for new type
    if (patch.fieldId !== undefined) {
      const field = props.fields.find((f) => f.id === patch.fieldId);
      if (field) {
        const ops = opsForType(field.type);
        next[index] = { ...next[index]!, op: ops[0]?.id ?? "", value: "" };
      }
    }
    setLeaves(next);
  };

  const addLeaf = () => setLeaves([...leaves(), blankLeaf(fields())]);
  const removeLeaf = (index: number) => setLeaves(leaves().filter((_, i) => i !== index));
  const clearAll = () => {
    setLeaves([]);
    navigateTo(buildFilterUrl(props.baseUrl, []));
  };

  const dirty = createMemo(() => {
    const a = JSON.stringify(props.initial);
    const b = JSON.stringify(leaves().filter((l) => isComplete(l, props.fields)));
    return a !== b;
  });

  if (fields().length === 0) return null;

  return (
    <div class="flex flex-col gap-2">
      <Show
        when={leaves().length > 0}
        fallback={
          <div class="flex items-center gap-2">
            <button type="button" class="btn-simple btn-sm text-xs text-dimmed" onClick={addLeaf}>
              <i class="ti ti-filter-plus" /> Filter
            </button>
          </div>
        }
      >
        <div class="flex flex-col gap-1.5">
          <For each={leaves()}>
            {(leaf, index) => {
              const field = createMemo(() => props.fields.find((f) => f.id === leaf.fieldId) ?? null);
              const ops = createMemo<FilterOp[]>(() => (field() ? opsForType(field()!.type) : []));
              const op = createMemo<FilterOp | null>(() => ops().find((o) => o.id === leaf.op) ?? null);

              return (
                <div class="flex flex-wrap items-center gap-1.5 text-xs">
                  <span class="text-dimmed">{index() === 0 ? "where" : "and"}</span>
                  <select
                    class="rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs"
                    value={leaf.fieldId}
                    onChange={(e) => updateLeaf(index(), { fieldId: e.currentTarget.value })}
                  >
                    <For each={fields()}>
                      {(f) => <option value={f.id}>{f.name}</option>}
                    </For>
                  </select>
                  <select
                    class="rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs"
                    value={leaf.op}
                    onChange={(e) => updateLeaf(index(), { op: e.currentTarget.value, value: "" })}
                  >
                    <For each={ops()}>
                      {(o) => <option value={o.id}>{o.label}</option>}
                    </For>
                  </select>

                  <FilterValueInput
                    field={field()}
                    op={op()}
                    value={leaf.value}
                    onChange={(v) => updateLeaf(index(), { value: v })}
                  />

                  <button
                    type="button"
                    class="text-dimmed hover:text-red-500 px-1"
                    onClick={() => removeLeaf(index())}
                    title="Remove filter"
                  >
                    <i class="ti ti-x" />
                  </button>
                </div>
              );
            }}
          </For>

          <div class="flex items-center gap-2">
            <button type="button" class="btn-simple btn-sm text-xs text-dimmed" onClick={addLeaf}>
              <i class="ti ti-plus" /> Add filter
            </button>
            <button
              type="button"
              class="btn-simple btn-sm text-xs text-red-500 hover:text-red-600"
              onClick={clearAll}
            >
              <i class="ti ti-x" /> Clear all
            </button>
            <Show when={dirty()}>
              <button
                type="button"
                class="btn-primary btn-sm text-xs ml-auto"
                onClick={apply}
                title="Apply filter (Enter)"
              >
                <i class="ti ti-check" /> Apply
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

/**
 * Renders the right-hand value input for a filter row, type-aware. For
 * "between" we render two inputs side by side; for ops with no value we
 * render nothing.
 */
function FilterValueInput(props: {
  field: Field | null;
  op: FilterOp | null;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const field = props.field;
  const op = props.op;
  if (!field || !op || !op.needsValue) return null;

  const inputClass =
    "rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs min-w-[8rem]";

  // Range (between): two inputs.
  if (op.needsRange) {
    const range = Array.isArray(props.value) ? (props.value as [unknown, unknown]) : ["", ""];
    const inputType = field.type === "date" ? "date" : "number";
    return (
      <span class="flex items-center gap-1">
        <input
          type={inputType}
          class={inputClass}
          value={range[0] != null ? String(range[0]) : ""}
          onInput={(e) => props.onChange([e.currentTarget.value, range[1]])}
        />
        <span class="text-dimmed">to</span>
        <input
          type={inputType}
          class={inputClass}
          value={range[1] != null ? String(range[1]) : ""}
          onInput={(e) => props.onChange([range[0], e.currentTarget.value])}
        />
      </span>
    );
  }

  // Single-select / multi-select: dropdown built from field.config.options.
  if (field.type === "single-select" && (op.id === "is" || op.id === "isNot")) {
    const options = ((field.config as { options?: Array<{ id: string; label: string }> }).options ?? []);
    return (
      <select
        class={inputClass}
        value={typeof props.value === "string" ? props.value : ""}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        <option value="">—</option>
        <For each={options}>{(o) => <option value={o.id}>{o.label}</option>}</For>
      </select>
    );
  }

  // Multi-value ops (isAnyOf / isNoneOf / containsAll / containsAny / doesNotContain):
  // accept a comma-separated list — the API expects an array of strings.
  if (op.id === "isAnyOf" || op.id === "isNoneOf" || op.id === "containsAll" || op.id === "containsAny" || op.id === "doesNotContain") {
    const display = Array.isArray(props.value) ? props.value.join(", ") : String(props.value ?? "");
    return (
      <input
        type="text"
        class={inputClass}
        placeholder="comma-separated"
        value={display}
        onInput={(e) => {
          const parts = e.currentTarget.value.split(",").map((s) => s.trim()).filter(Boolean);
          props.onChange(parts);
        }}
      />
    );
  }

  if (field.type === "boolean") {
    return (
      <select
        class={inputClass}
        value={props.value === true ? "true" : props.value === false ? "false" : ""}
        onChange={(e) => props.onChange(e.currentTarget.value === "true")}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (field.type === "date") {
    return (
      <input
        type="date"
        class={inputClass}
        value={typeof props.value === "string" ? props.value : ""}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    );
  }

  if (field.type === "number" || field.type === "decimal" || field.type === "rating" || field.type === "autonumber") {
    return (
      <input
        type="number"
        class={inputClass}
        value={typeof props.value === "number" || typeof props.value === "string" ? String(props.value) : ""}
        onInput={(e) => {
          const n = e.currentTarget.valueAsNumber;
          props.onChange(Number.isFinite(n) ? n : e.currentTarget.value);
        }}
      />
    );
  }

  // Default: text.
  return (
    <input
      type="text"
      class={inputClass}
      value={typeof props.value === "string" ? props.value : ""}
      onInput={(e) => props.onChange(e.currentTarget.value)}
    />
  );
}
