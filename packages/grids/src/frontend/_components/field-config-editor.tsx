import { For, Show } from "solid-js";
import { Select, TextInput } from "@valentinkolb/cloud/ui";
import type { Field } from "../../service";

// =============================================================================
// Type catalog
// =============================================================================

export type FieldConfigState = Record<string, unknown>;

export const TYPE_OPTIONS = [
  // Tier 1
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "decimal", label: "Decimal (money-safe)" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "single-select", label: "Single select" },
  { value: "multi-select", label: "Multi select" },
  { value: "rating", label: "Rating" },
  { value: "autonumber", label: "Auto-number" },
  // Tier 2
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
  { value: "phone", label: "Phone" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
  { value: "duration", label: "Duration" },
  { value: "slug", label: "Slug" },
  // Tier 3
  { value: "barcode", label: "Barcode / QR" },
  { value: "isbn", label: "ISBN" },
  { value: "color", label: "Color" },
  { value: "rich-text", label: "Rich text (markdown)" },
  { value: "json", label: "JSON" },
  { value: "signature", label: "Signature" },
  { value: "location", label: "Location" },
  // Phase 4 / 5
  { value: "relation", label: "Relation (link to another table)" },
  { value: "lookup", label: "Lookup (project a field through a relation)" },
  { value: "rollup", label: "Rollup (aggregate over a relation)" },
  { value: "formula", label: "Formula" },
];

export const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

// System fields are read-only and never reach this editor, but include them
// for the column-type pill in the list view.
TYPE_LABELS["created_at"] = "Created at";
TYPE_LABELS["updated_at"] = "Updated at";
TYPE_LABELS["created_by"] = "Created by";
TYPE_LABELS["updated_by"] = "Updated by";

/** Default config blob for a brand-new field of `type`. */
export const defaultConfigForType = (type: string): FieldConfigState => {
  switch (type) {
    case "decimal":
      return { precision: 10, scale: 2 };
    case "rating":
      return { scale: 5 };
    case "single-select":
    case "multi-select":
      return { options: [] };
    case "autonumber":
      return { padding: 1 };
    case "currency":
      return { defaultCurrency: "EUR" };
    case "date":
      return { includeTime: false };
    default:
      return {};
  }
};

// =============================================================================
// Top-level editor — switches sub-form by type
// =============================================================================

type EditorProps = {
  type: string;
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
  /** All sibling tables in the same base — used by relation type targetTableId. */
  otherTables: Array<{ id: string; name: string }>;
  /** Fields per table id — used for displayFieldId / lookup-rollup target picker. */
  fieldsByTable: Record<string, Field[]>;
};

// Set of types we know how to show a constraint form for. Anything outside
// this set falls into the "no extra configuration" hint.
const CONFIGURABLE = new Set([
  "text",
  "longtext",
  "rich-text",
  "number",
  "percent",
  "duration",
  "decimal",
  "rating",
  "date",
  "single-select",
  "multi-select",
  "autonumber",
  "currency",
  "relation",
  "lookup",
  "rollup",
  "formula",
]);

/**
 * Renders the constraint / config form for a single field type. Each
 * sub-form is a thin layer that owns its inputs and pushes a new config
 * blob to the parent on every change. The blob's shape mirrors the
 * server-side configSchema in packages/grids/src/field-types/<type>.ts.
 *
 * Email / url / phone / slug / barcode / isbn / color / json / signature /
 * location have no user-tunable constraints in the current schema, so they
 * fall through to a "nothing to configure" hint.
 */
export function FieldConfigEditor(props: EditorProps) {
  // Description has been promoted to a top-level Field column; the new
  // table editor renders its own input for it. This component now focuses
  // purely on type-specific constraint forms.
  return (
    <div class="flex flex-col gap-3 p-3 rounded-md bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-700">
      <span class="text-xs font-medium text-secondary">Type constraints</span>
      <Show when={props.type === "text" || props.type === "longtext" || props.type === "rich-text"}>
        <TextConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "number" || props.type === "percent" || props.type === "duration"}>
        <NumberConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "decimal"}>
        <DecimalConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "rating"}>
        <RatingConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "date"}>
        <DateConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "single-select" || props.type === "multi-select"}>
        <SelectConstraints
          config={props.config}
          onChange={props.onChange}
          multi={props.type === "multi-select"}
        />
      </Show>
      <Show when={props.type === "autonumber"}>
        <AutonumberConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "currency"}>
        <CurrencyConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "relation"}>
        <RelationConstraints
          config={props.config}
          onChange={props.onChange}
          otherTables={props.otherTables}
          fieldsByTable={props.fieldsByTable}
        />
      </Show>
      <Show when={props.type === "lookup" || props.type === "rollup"}>
        <LookupRollupConstraints
          config={props.config}
          onChange={props.onChange}
          isRollup={props.type === "rollup"}
        />
      </Show>
      <Show when={props.type === "formula"}>
        <FormulaConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={!CONFIGURABLE.has(props.type)}>
        <p class="text-xs text-dimmed">This field type has no extra configuration.</p>
      </Show>
    </div>
  );
}

// =============================================================================
// Sub-forms — one per type family
// =============================================================================

function TextConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const minLen = () => (typeof cfg().minLength === "number" ? String(cfg().minLength) : "");
  const maxLen = () => (typeof cfg().maxLength === "number" ? String(cfg().maxLength) : "");
  const regex = () => (typeof cfg().regex === "string" ? (cfg().regex as string) : "");

  const onMin = (v: string) => {
    const n = v.trim() === "" ? undefined : Number(v);
    if (n !== undefined && (!Number.isInteger(n) || n < 0)) return;
    update({ minLength: n });
  };
  const onMax = (v: string) => {
    const n = v.trim() === "" ? undefined : Number(v);
    if (n !== undefined && (!Number.isInteger(n) || n < 1)) return;
    update({ maxLength: n });
  };

  return (
    <div class="grid grid-cols-2 gap-3">
      <NumberField label="Min length (optional)" value={minLen} onInput={onMin} min={0} />
      <NumberField label="Max length (optional)" value={maxLen} onInput={onMax} min={1} />
      <div class="col-span-2">
        <TextInput
          label="Pattern (regex, optional)"
          value={regex}
          onInput={(v) => update({ regex: v.trim() === "" ? undefined : v })}
          placeholder="e.g. ^[A-Z]{3}-\\d+$"
          icon="ti ti-regex"
        />
      </div>
    </div>
  );
}

function NumberConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const min = () => (typeof cfg().min === "number" ? String(cfg().min) : "");
  const max = () => (typeof cfg().max === "number" ? String(cfg().max) : "");
  const integerOnly = () => Boolean(cfg().integerOnly);

  return (
    <div class="grid grid-cols-2 gap-3">
      <NumberField
        label="Min (optional)"
        value={min}
        onInput={(v) => update({ min: v.trim() === "" ? undefined : Number(v) })}
      />
      <NumberField
        label="Max (optional)"
        value={max}
        onInput={(v) => update({ max: v.trim() === "" ? undefined : Number(v) })}
      />
      <label class="col-span-2 inline-flex items-center gap-2 text-xs text-secondary">
        <input
          type="checkbox"
          checked={integerOnly()}
          onChange={(e) => update({ integerOnly: e.currentTarget.checked || undefined })}
        />
        Integer only
      </label>
    </div>
  );
}

function DecimalConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const precision = () =>
    typeof cfg().precision === "number" ? String(cfg().precision) : "10";
  const scale = () => (typeof cfg().scale === "number" ? String(cfg().scale) : "2");
  const min = () => (typeof cfg().min === "string" ? (cfg().min as string) : "");
  const max = () => (typeof cfg().max === "string" ? (cfg().max as string) : "");

  return (
    <div class="grid grid-cols-2 gap-3">
      <NumberField
        label="Precision (total digits, 1-38)"
        value={precision}
        min={1}
        max={38}
        onInput={(v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 1 && n <= 38) update({ precision: n });
        }}
      />
      <NumberField
        label="Scale (decimal places)"
        value={scale}
        min={0}
        max={20}
        onInput={(v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 0 && n <= 20) update({ scale: n });
        }}
      />
      <TextInput
        label="Min (optional)"
        value={min}
        onInput={(v) => update({ min: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. 0"
      />
      <TextInput
        label="Max (optional)"
        value={max}
        onInput={(v) => update({ max: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. 9999.99"
      />
    </div>
  );
}

function RatingConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
}) {
  const cfg = () => props.config();
  const scale = () => (typeof cfg().scale === "number" ? String(cfg().scale) : "5");
  return (
    <div class="grid grid-cols-2 gap-3">
      <NumberField
        label="Scale (max stars, 2-10)"
        value={scale}
        min={2}
        max={10}
        onInput={(v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 2 && n <= 10) {
            props.onChange({ ...cfg(), scale: n });
          }
        }}
      />
    </div>
  );
}

function DateConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const min = () => (typeof cfg().min === "string" ? (cfg().min as string) : "");
  const max = () => (typeof cfg().max === "string" ? (cfg().max as string) : "");

  return (
    <div class="grid grid-cols-2 gap-3">
      <label class="col-span-2 inline-flex items-center gap-2 text-xs text-secondary">
        <input
          type="checkbox"
          checked={Boolean(cfg().includeTime)}
          onChange={(e) => update({ includeTime: e.currentTarget.checked || undefined })}
        />
        Include time-of-day
      </label>
      <TextInput
        label="Min date (optional, YYYY-MM-DD)"
        value={min}
        onInput={(v) => update({ min: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. 2020-01-01"
      />
      <TextInput
        label="Max date (optional, YYYY-MM-DD)"
        value={max}
        onInput={(v) => update({ max: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. 2099-12-31"
      />
    </div>
  );
}

// -- single/multi-select options manager (inline, no nested modal) -----------

const DEFAULT_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `opt-${Math.random().toString(36).slice(2, 7)}`;

type SelectOption = { id: string; label: string; color?: string };

function SelectConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
  multi: boolean;
}) {
  const cfg = () => props.config();
  const options = () => (Array.isArray(cfg().options) ? (cfg().options as SelectOption[]) : []);

  const writeOptions = (next: SelectOption[]) =>
    props.onChange({ ...cfg(), options: next });

  const addOption = () => {
    const idx = options().length;
    const color = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
    writeOptions([...options(), { id: `option-${idx + 1}`, label: `Option ${idx + 1}`, color }]);
  };

  const updateOption = (i: number, patch: Partial<SelectOption>) => {
    writeOptions(options().map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };

  const removeOption = (i: number) => writeOptions(options().filter((_, idx) => idx !== i));

  const onLabelChange = (i: number, label: string) => {
    const opt = options()[i];
    if (!opt) return;
    const previousIdFromLabel = slugify(opt.label);
    if (opt.id === previousIdFromLabel || opt.id.startsWith("option-")) {
      updateOption(i, { label, id: slugify(label) });
    } else {
      updateOption(i, { label });
    }
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-xs text-secondary">Options</span>
        <button type="button" class="btn-simple btn-sm text-xs" onClick={addOption}>
          <i class="ti ti-plus" /> Add option
        </button>
      </div>
      <Show
        when={options().length > 0}
        fallback={<p class="text-xs text-dimmed py-1">No options yet.</p>}
      >
        <div class="flex flex-col gap-2">
          <For each={options()}>
            {(opt, i) => (
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="h-7 w-7 cursor-pointer rounded border border-zinc-200 dark:border-zinc-700"
                  value={opt.color ?? "#3b82f6"}
                  onInput={(e) => updateOption(i(), { color: e.currentTarget.value })}
                  aria-label="Color"
                />
                <input
                  type="text"
                  class="flex-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm"
                  placeholder="Label"
                  value={opt.label}
                  onInput={(e) => onLabelChange(i(), e.currentTarget.value)}
                />
                <input
                  type="text"
                  class="w-32 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs font-mono text-dimmed"
                  placeholder="id"
                  value={opt.id}
                  onInput={(e) => updateOption(i(), { id: e.currentTarget.value })}
                />
                <button
                  type="button"
                  class="text-dimmed hover:text-red-500"
                  onClick={() => removeOption(i())}
                  title="Remove"
                >
                  <i class="ti ti-x" />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.multi}>
        <div class="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-700">
          <NumberField
            label="Min selected (optional)"
            value={() => (typeof cfg().minSelected === "number" ? String(cfg().minSelected) : "")}
            min={0}
            onInput={(v) => {
              const n = v.trim() === "" ? undefined : Number(v);
              if (n === undefined || (Number.isInteger(n) && n >= 0)) {
                props.onChange({ ...cfg(), minSelected: n });
              }
            }}
          />
          <NumberField
            label="Max selected (optional)"
            value={() => (typeof cfg().maxSelected === "number" ? String(cfg().maxSelected) : "")}
            min={1}
            onInput={(v) => {
              const n = v.trim() === "" ? undefined : Number(v);
              if (n === undefined || (Number.isInteger(n) && n >= 1)) {
                props.onChange({ ...cfg(), maxSelected: n });
              }
            }}
          />
        </div>
      </Show>
    </div>
  );
}

function AutonumberConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });
  const prefix = () => (typeof cfg().prefix === "string" ? (cfg().prefix as string) : "");
  const padding = () => (typeof cfg().padding === "number" ? String(cfg().padding) : "1");

  return (
    <div class="grid grid-cols-2 gap-3">
      <TextInput
        label="Prefix (optional)"
        value={prefix}
        onInput={(v) => update({ prefix: v === "" ? undefined : v })}
        placeholder="e.g. INV-"
      />
      <NumberField
        label="Padding (zero-pad to N digits)"
        value={padding}
        min={1}
        max={10}
        onInput={(v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 1 && n <= 10) update({ padding: n });
        }}
      />
    </div>
  );
}

function CurrencyConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
}) {
  const cfg = () => props.config();
  const def = () => (typeof cfg().defaultCurrency === "string" ? (cfg().defaultCurrency as string) : "EUR");
  return (
    <div>
      <TextInput
        label="Default currency code (ISO-4217)"
        value={def}
        onInput={(v) => props.onChange({ ...cfg(), defaultCurrency: v.trim().toUpperCase() || undefined })}
        placeholder="EUR"
      />
    </div>
  );
}

function RelationConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const targetTableId = () =>
    typeof cfg().targetTableId === "string" ? (cfg().targetTableId as string) : "";
  const displayFieldId = () =>
    typeof cfg().displayFieldId === "string" ? (cfg().displayFieldId as string) : "";
  const cardinality = () =>
    cfg().cardinality === "single" ? "single" : "multiple";

  const targetFields = () => (targetTableId() ? props.fieldsByTable[targetTableId()] ?? [] : []);

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={props.otherTables.length > 0}
        fallback={
          <p class="text-xs text-amber-600 dark:text-amber-400">
            No other tables to link to. Create a second table first.
          </p>
        }
      >
        <Select
          label="Target table"
          value={targetTableId}
          onChange={(v) => update({ targetTableId: v, displayFieldId: undefined })}
          options={props.otherTables.map((t) => ({ id: t.id, label: t.name }))}
          placeholder="Pick a table..."
          required
        />
      </Show>
      <Show when={targetFields().length > 0}>
        <Select
          label="Display field (shown when rendering this relation)"
          value={displayFieldId}
          onChange={(v) => update({ displayFieldId: v })}
          options={targetFields()
            .filter((f) => !f.deletedAt)
            .map((f) => ({ id: f.id, label: f.name }))}
          placeholder="Pick a field..."
        />
      </Show>
      <Select
        label="Cardinality"
        value={cardinality}
        onChange={(v) => update({ cardinality: v })}
        options={[
          { id: "single", label: "Single — one linked record" },
          { id: "multiple", label: "Multiple — many linked records" },
        ]}
      />
    </div>
  );
}

function LookupRollupConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
  isRollup: boolean;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });
  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-dimmed">
        Configure {props.isRollup ? "rollup" : "lookup"} via the JSON config — pick a relation
        field id and a target field id from the linked table. UI picker
        coming in a follow-up; for now use the API or paste IDs:
      </p>
      <TextInput
        label="Relation field id"
        value={() =>
          typeof cfg().relationFieldId === "string" ? (cfg().relationFieldId as string) : ""
        }
        onInput={(v) => update({ relationFieldId: v.trim() || undefined })}
        placeholder="<uuid of a relation field on this table>"
      />
      <TextInput
        label="Target field id (on the linked table)"
        value={() =>
          typeof cfg().targetFieldId === "string" ? (cfg().targetFieldId as string) : ""
        }
        onInput={(v) => update({ targetFieldId: v.trim() || undefined })}
        placeholder="<uuid of a field on the target table>"
      />
      <Show when={props.isRollup}>
        <Select
          label="Aggregate"
          value={() => (typeof cfg().agg === "string" ? (cfg().agg as string) : "count")}
          onChange={(v) => update({ agg: v })}
          options={[
            { id: "count", label: "count" },
            { id: "sum", label: "sum" },
            { id: "avg", label: "avg" },
            { id: "min", label: "min" },
            { id: "max", label: "max" },
          ]}
        />
      </Show>
    </div>
  );
}

function FormulaConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
}) {
  const cfg = () => props.config();
  const expr = () =>
    typeof cfg().expression === "string" ? (cfg().expression as string) : "";
  return (
    <div class="flex flex-col gap-2">
      <TextInput
        label="Expression"
        value={expr}
        onInput={(v) => props.onChange({ ...cfg(), expression: v })}
        placeholder='e.g. {field-id} * 1.19  or  CONCAT(UPPER({title}), " — €", {price})'
        icon="ti ti-math-function"
        multiline
      />
      <p class="text-xs text-dimmed">
        Reference fields by their UUID in <code>{`{...}`}</code>. Functions: IF, AND, OR, NOT,
        ISBLANK, ABS, ROUND, FLOOR, CEIL, MIN, MAX, CONCAT, LEN, LOWER, UPPER, TRIM,
        TODAY, NOW, YEAR, MONTH, DAY, DATEADD, DATEDIFF.
      </p>
    </div>
  );
}

// =============================================================================
// Tiny shared input helper
// =============================================================================

function NumberField(props: {
  label: string;
  value: () => string;
  onInput: (v: string) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label class="flex flex-col gap-1">
      <span class="text-xs text-secondary">{props.label}</span>
      <input
        type="number"
        min={props.min}
        max={props.max}
        class="rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm"
        value={props.value()}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
    </label>
  );
}
