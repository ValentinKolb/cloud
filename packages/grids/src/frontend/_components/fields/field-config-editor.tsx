import {
  AutocompleteEditor,
  CheckboxCard,
  ColorInput,
  DataTable,
  type DataTableColumn,
  NumberInput,
  Select,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, Index, Show } from "solid-js";
import type { Field } from "../../../service";
import { apiClient } from "../../../api/client";
import { buildFormulaCompletions, formulaFieldRefs, formulaFieldToken, formulaHighlight } from "./formula-authoring";
import { errorMessage } from "../utils/api-helpers";

// =============================================================================
// Type catalog
// =============================================================================

export type FieldConfigState = Record<string, unknown>;

const REGEX_PRESETS = [
  { label: "Email", value: "^[^ @]+@[^ @]+\\.[^ @]{2,}$" },
  { label: "URL", value: "^https?://.+$" },
  { label: "Phone", value: "^\\+?[0-9 .()\\-]{5,}$" },
  { label: "Slug", value: "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$" },
  { label: "ISBN", value: "^[0-9Xx -]{10,17}$" },
];

const FILE_ACCEPT_PRESETS = [
  { label: "Images", values: ["image/*"] },
  {
    label: "Photos",
    values: ["image/jpeg", "image/png", "image/heic", "image/webp"],
  },
  { label: "PDF", values: ["application/pdf", ".pdf"] },
  {
    label: "Spreadsheets",
    values: [
      ".csv",
      ".tsv",
      ".xls",
      ".xlsx",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
  {
    label: "Documents",
    values: [".doc", ".docx", ".odt", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  { label: "Text", values: ["text/plain", ".txt", ".md"] },
  { label: "Archives", values: [".zip", ".tar", ".gz", ".7z"] },
];

export const TYPE_OPTIONS = [
  // Tier 1
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
  { value: "autonumber", label: "Auto-number" },
  // Tier 2
  { value: "percent", label: "Percent" },
  { value: "duration", label: "Duration" },
  // Tier 3
  { value: "json", label: "JSON" },
  { value: "file", label: "File" },
  // Phase 4 / 5
  { value: "relation", label: "Relation (link to another table)" },
  { value: "lookup", label: "Lookup (project a field through a relation)" },
  { value: "rollup", label: "Rollup (aggregate over a relation)" },
  { value: "formula", label: "Formula" },
];

export const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));

// System fields are read-only and never reach this editor, but include them
// for the column-type pill in the list view.
TYPE_LABELS["created_at"] = "Created at";
TYPE_LABELS["updated_at"] = "Updated at";
TYPE_LABELS["created_by"] = "Created by";
TYPE_LABELS["updated_by"] = "Updated by";

/**
 * Plain-language primer per field type. Aimed at someone who's never
 * built a database — explain WHAT the field is for and WHEN to pick it,
 * not how it's stored. The constraint inputs further down (precision,
 * regex, cardinality) should make sense after reading these.
 */
export const FIELD_TYPE_DESCRIPTIONS: Record<string, string> = {
  text: "A single line of text — names, titles, codes, anything short. Set min/max length if the value should be a certain size, or a regex pattern to enforce a format like a postcode.",
  longtext: "Multi-line text — paragraphs, notes, instructions. Bound the size the same way as text if you need to.",
  number:
    "A number, stored decimal-safe. Use decimal places for money or exact measurements; set 0 decimal places for whole numbers.",
  boolean: "A yes/no checkbox.",
  date: "A calendar date, optionally with a time. Bound it to a min and/or max date if you only want values in a certain range.",
  select: "A fixed list of choices. Use single mode for one choice, or multiple mode for tags/categories.",
  autonumber:
    'An auto-incrementing number that fills itself in on every new record. Add a prefix (e.g. "INV-") or zero-pad to a fixed width.',
  percent: "A percentage from 0 to 100.",
  duration: "A length of time. Type as HH:MM:SS or seconds; displayed as HH:MM:SS.",
  json: "A free-form JSON value. Use this when no other type fits.",
  file: "Small files stored directly in Postgres. The app-level upload limit is controlled from the Grids admin settings.",
  relation: "A link to one or more records in another table. Pick the target table and which of its columns to show.",
  lookup: "Pulls a column from a linked record so you can see it on this row, without copying the data.",
  rollup: "Summarises values from linked records — count them, add them up, average them, or take the smallest or largest.",
  formula:
    "A computed value, recalculated whenever the row is read. Reference other columns by their #slug (e.g. #price) and use functions like IF, CONCAT, ROUND, AVG.",
};

/** Default config blob for a brand-new field of `type`. */
export const defaultConfigForType = (type: string): FieldConfigState => {
  switch (type) {
    case "select":
      return { multiple: false, options: [] };
    case "autonumber":
      return { padding: 1 };
    case "date":
      return { includeTime: false };
    case "file":
      return { maxFiles: 10 };
    default:
      return {};
  }
};

// =============================================================================
// Top-level editor — switches sub-form by type
// =============================================================================

type EditorProps = {
  currentFieldId?: string;
  type: string;
  /** ID of the table this field lives on. Needed by lookup/rollup so
   *  the relation-field picker can list THIS table's relation fields. */
  currentTableId: string;
  baseShortId?: string;
  tableShortId?: string;
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
  /** All sibling tables in the same base — used by relation type targetTableId. */
  otherTables: Array<{ id: string; name: string }>;
  /** Fields per table id — used for lookup/rollup target pickers. */
  fieldsByTable: Record<string, Field[]>;
};

/** Field types that can't sensibly serve as a presentable label or as
 *  a lookup/rollup target — they either nest deeper or render badly as
 *  a flat value. Filtering them out keeps target/displayField pickers
 *  focused on scalar fields. */
const NON_PRESENTABLE_TYPES = new Set(["relation", "lookup", "rollup", "formula", "file"]);

// Set of types we know how to show a constraint form for. Anything outside
// this set falls into the "no extra configuration" hint.
const CONFIGURABLE = new Set([
  "text",
  "longtext",
  "number",
  "percent",
  "duration",
  "date",
  "select",
  "autonumber",
  "relation",
  "lookup",
  "rollup",
  "formula",
  "file",
]);

/**
 * Renders the constraint / config form for a single field type. Each
 * sub-form is a thin layer that owns its inputs and pushes a new config
 * blob to the parent on every change. The blob's shape mirrors the
 * server-side configSchema in packages/grids/src/field-types/<type>.ts.
 *
 * JSON has no user-tunable constraints in the current schema, so it falls
 * through to a "nothing to configure" hint.
 */
export function FieldConfigEditor(props: EditorProps) {
  // Description has been promoted to a top-level Field column; the new
  // table editor renders its own input for it. This component now focuses
  // purely on type-specific constraint forms.
  return (
    <div class="flex flex-col gap-3">
      <Show when={props.type === "text" || props.type === "longtext"}>
        <TextConstraints config={props.config} onChange={props.onChange} markdown={props.type === "longtext"} />
      </Show>
      <Show when={props.type === "number" || props.type === "percent" || props.type === "duration"}>
        <NumberConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "date"}>
        <DateConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "select"}>
        <SelectConstraints config={props.config} onChange={props.onChange} />
      </Show>
      <Show when={props.type === "autonumber"}>
        <AutonumberConstraints config={props.config} onChange={props.onChange} />
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
          currentTableId={props.currentTableId}
          fieldsByTable={props.fieldsByTable}
        />
      </Show>
      <Show when={props.type === "formula"}>
        <FormulaConstraints
          config={props.config}
          onChange={props.onChange}
          fields={props.fieldsByTable[props.currentTableId] ?? []}
          currentFieldId={props.currentFieldId}
          currentTableId={props.currentTableId}
          baseShortId={props.baseShortId}
          tableShortId={props.tableShortId}
        />
      </Show>
      <Show when={props.type === "file"}>
        <FileConstraints config={props.config} onChange={props.onChange} />
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

function TextConstraints(props: { config: () => FieldConfigState; onChange: (next: FieldConfigState) => void; markdown?: boolean }) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const minLen = () => (typeof cfg().minLength === "number" ? String(cfg().minLength) : "");
  const maxLen = () => (typeof cfg().maxLength === "number" ? String(cfg().maxLength) : "");
  const regex = () => (typeof cfg().regex === "string" ? (cfg().regex as string) : "");
  const markdown = () => Boolean(cfg().markdown);

  // Constraints are TextInputs (not NumberField/NumberInput) because the
  // optional semantics need an empty state — NumberInput clamps to its
  // `min` prop and has no way to represent "no constraint". Parse on
  // input, ignore non-numeric or negative input; empty string clears.
  // Matches DecimalConstraints' pattern for the same reason.
  const onLength = (key: "minLength" | "maxLength", v: string) => {
    const t = v.trim();
    if (t === "") return update({ [key]: undefined });
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0) return;
    update({ [key]: n });
  };

  return (
    <div class="grid grid-cols-2 gap-3">
      <TextInput
        label="Min length (optional)"
        description="Empty = no minimum."
        value={minLen}
        onInput={(v) => onLength("minLength", v)}
        placeholder="e.g. 3"
      />
      <TextInput
        label="Max length (optional)"
        description="Empty = no maximum."
        value={maxLen}
        onInput={(v) => onLength("maxLength", v)}
        placeholder="e.g. 50"
      />
      <div class="col-span-2">
        <TextInput
          label="Pattern (regex, optional)"
          description="Empty = no pattern check."
          value={regex}
          onInput={(v) => update({ regex: v.trim() === "" ? undefined : v })}
          placeholder="e.g. ^[A-Z]{3}-\\d+$"
          icon="ti ti-regex"
        />
        <div class="mt-2 flex flex-wrap gap-1.5">
          <For each={REGEX_PRESETS}>
            {(preset) => (
              <button
                type="button"
                class="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-secondary hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                onClick={() => update({ regex: preset.value })}
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>
      </div>
      <Show when={props.markdown}>
        <div class="col-span-2">
          <CheckboxCard
            label="Render as Markdown"
            description="Use Markdown input while editing and render formatted text in tables and detail panels."
            icon="ti ti-markdown"
            value={markdown}
            onChange={(checked) => update({ markdown: checked || undefined })}
          />
        </div>
      </Show>
    </div>
  );
}

function NumberConstraints(props: { config: () => FieldConfigState; onChange: (next: FieldConfigState) => void }) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const min = () => (typeof cfg().min === "number" || typeof cfg().min === "string" ? String(cfg().min) : "");
  const max = () => (typeof cfg().max === "number" || typeof cfg().max === "string" ? String(cfg().max) : "");
  const precision = () => (typeof cfg().precision === "number" ? String(cfg().precision) : "");
  const decimalPlaces = () =>
    typeof cfg().decimalPlaces === "number" ? String(cfg().decimalPlaces) : typeof cfg().scale === "number" ? String(cfg().scale) : "";
  const unit = () => (typeof cfg().unit === "string" ? (cfg().unit as string) : "");
  const unitPosition = () => (cfg().unitPosition === "prefix" ? "prefix" : "suffix");
  const integerOnly = () => Boolean(cfg().integerOnly);

  const onBound = (key: "min" | "max", v: string) => {
    const t = v.trim();
    if (t === "") return update({ [key]: undefined });
    update({ [key]: t });
  };
  const onInt = (key: "precision" | "decimalPlaces", v: string, minValue: number, maxValue: number) => {
    const t = v.trim();
    if (t === "") return update({ [key]: undefined, ...(key === "decimalPlaces" ? { scale: undefined } : {}) });
    const n = Number(t);
    if (!Number.isInteger(n) || n < minValue || n > maxValue) return;
    update({ [key]: n, ...(key === "decimalPlaces" ? { scale: undefined, integerOnly: n === 0 ? true : undefined } : {}) });
  };

  return (
    <div class="grid grid-cols-2 gap-3">
      <TextInput
        label="Min (optional)"
        description="Empty = no minimum."
        value={min}
        onInput={(v) => onBound("min", v)}
        placeholder="e.g. 0"
      />
      <TextInput
        label="Max (optional)"
        description="Empty = no maximum."
        value={max}
        onInput={(v) => onBound("max", v)}
        placeholder="e.g. 100"
      />
      <TextInput
        label="Precision (optional)"
        description="Max total digits. Empty = no limit."
        value={precision}
        onInput={(v) => onInt("precision", v, 1, 38)}
        placeholder="e.g. 16"
      />
      <TextInput
        label="Decimal places (optional)"
        description="Empty = flexible. Use 0 for whole numbers."
        value={decimalPlaces}
        onInput={(v) => onInt("decimalPlaces", v, 0, 20)}
        placeholder="e.g. 2"
      />
      <TextInput
        label="Unit (optional)"
        description="Display-only label such as EUR, kg, %, or credits."
        value={unit}
        onInput={(v) => update({ unit: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. EUR"
      />
      <Select
        label="Unit position"
        value={unitPosition}
        onChange={(v) => update({ unitPosition: v })}
        options={[
          { id: "suffix", label: "After value" },
          { id: "prefix", label: "Before value" },
        ]}
      />
      <div class="col-span-2">
        <CheckboxCard
          label="Integer only"
          description="Reject decimal values for this field."
          icon="ti ti-number"
          value={integerOnly}
          onChange={(checked) => update({ integerOnly: checked || undefined, decimalPlaces: checked ? 0 : undefined, scale: undefined })}
        />
      </div>
    </div>
  );
}

function DateConstraints(props: { config: () => FieldConfigState; onChange: (next: FieldConfigState) => void }) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const min = () => (typeof cfg().min === "string" ? (cfg().min as string) : "");
  const max = () => (typeof cfg().max === "string" ? (cfg().max as string) : "");

  return (
    <div class="grid grid-cols-2 gap-3">
      <div class="col-span-2">
        <CheckboxCard
          label="Include time-of-day"
          description="Store and edit date plus time. Leave off for pure calendar dates."
          icon="ti ti-clock"
          value={() => Boolean(cfg().includeTime)}
          onChange={(checked) => update({ includeTime: checked || undefined })}
        />
      </div>
      <TextInput
        label="Min date (optional, YYYY-MM-DD)"
        description="Empty = no minimum."
        value={min}
        onInput={(v) => update({ min: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. 2020-01-01"
      />
      <TextInput
        label="Max date (optional, YYYY-MM-DD)"
        description="Empty = no maximum."
        value={max}
        onInput={(v) => update({ max: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. 2099-12-31"
      />
    </div>
  );
}

// -- select options manager (inline, no nested modal) ------------------------

const DEFAULT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `opt-${Math.random().toString(36).slice(2, 7)}`;

type SelectOption = { id: string; label: string; color?: string; description?: string };

function SelectConstraints(props: { config: () => FieldConfigState; onChange: (next: FieldConfigState) => void }) {
  const cfg = () => props.config();
  const multiple = () => cfg().multiple === true;
  const options = () => (Array.isArray(cfg().options) ? (cfg().options as SelectOption[]) : []);

  const writeOptions = (next: SelectOption[]) => props.onChange({ ...cfg(), options: next });

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
    <div class="flex flex-col gap-3">
      <Select
        label="Mode"
        value={() => (multiple() ? "multiple" : "single")}
        onChange={(v) =>
          props.onChange({
            ...cfg(),
            multiple: v === "multiple",
            minSelected: v === "multiple" ? cfg().minSelected : undefined,
            maxSelected: v === "multiple" ? cfg().maxSelected : undefined,
          })
        }
        options={[
          { id: "single", label: "Single choice", description: "Users can pick one option." },
          { id: "multiple", label: "Multiple choices", description: "Users can pick several options." },
        ]}
      />
      <div class="flex items-center justify-between">
        <span class="text-xs text-secondary">Options</span>
        <button type="button" class="btn-simple btn-sm text-xs" onClick={addOption}>
          <i class="ti ti-plus" /> Add option
        </button>
      </div>
      <Show when={options().length > 0} fallback={<p class="text-xs text-dimmed py-1">No options yet.</p>}>
        <div class="flex flex-col gap-2">
          {/* Column headers — sit above the input cells. The leading w-7
              spacer matches the colour swatch column so "Label" and
              "Value" line up with the inputs below. */}
          <div class="flex items-center gap-2 text-[11px] text-dimmed">
            <span class="w-7 shrink-0" />
            <span class="min-w-44 flex-1">Label</span>
            <span class="min-w-56 flex-1">Description</span>
            <span class="w-40 shrink-0">Value</span>
            <span class="w-5 shrink-0" />
          </div>
          {/* Index (not For) — keys by position. Each keystroke writes
              a fresh options array with new object identities, which a
              reference-keyed For interprets as "row replaced", remounting
              the inputs and stealing focus mid-typing. Index keeps the
              row stable; only the bound accessors update. */}
          <Index each={options()}>
            {(opt, i) => (
              <div class="flex items-center gap-2">
                <ColorInput compact value={() => opt().color ?? "#3b82f6"} onChange={(c) => updateOption(i, { color: c })} />
                <div class="flex-1">
                  <TextInput placeholder="Label" icon="ti ti-tag" value={() => opt().label} onInput={(v) => onLabelChange(i, v)} />
                </div>
                <div class="flex-1">
                  <TextInput
                    placeholder="Description"
                    icon="ti ti-info-circle"
                    value={() => opt().description ?? ""}
                    onInput={(v) => updateOption(i, { description: v.trim() ? v : undefined })}
                    clearable
                  />
                </div>
                <div class="w-40 shrink-0">
                  <TextInput placeholder="value" icon="ti ti-id" value={() => opt().id} onInput={(v) => updateOption(i, { id: v })} />
                </div>
                <button
                  type="button"
                  class="text-dimmed hover:text-red-500 p-1 shrink-0"
                  onClick={() => removeOption(i)}
                  title="Remove"
                  aria-label="Remove option"
                >
                  <i class="ti ti-x" />
                </button>
              </div>
            )}
          </Index>
        </div>
      </Show>
      <Show when={multiple()}>
        <div class="grid grid-cols-2 gap-3 pt-2">
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

function AutonumberConstraints(props: { config: () => FieldConfigState; onChange: (next: FieldConfigState) => void }) {
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

function RelationConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const targetTableId = () => (typeof cfg().targetTableId === "string" ? (cfg().targetTableId as string) : "");
  const cardinality = () => (cfg().cardinality === "single" ? "single" : "multiple");

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={props.otherTables.length > 0}
        fallback={<p class="text-xs text-amber-600 dark:text-amber-400">No other tables to link to. Create a second table first.</p>}
      >
        <Select
          label="Target table"
          value={targetTableId}
          onChange={(v) => update({ targetTableId: v })}
          options={props.otherTables.map((t) => ({ id: t.id, label: t.name }))}
          placeholder="Pick a table..."
          required
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
  currentTableId: string;
  fieldsByTable: Record<string, Field[]>;
}) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const relationFieldId = () => (typeof cfg().relationFieldId === "string" ? (cfg().relationFieldId as string) : "");
  const targetFieldId = () => (typeof cfg().targetFieldId === "string" ? (cfg().targetFieldId as string) : "");

  // Relation fields available on THIS table — the lookup/rollup follows
  // one of them to reach the target table.
  const relationFields = () => (props.fieldsByTable[props.currentTableId] ?? []).filter((f) => f.type === "relation" && !f.deletedAt);

  // Resolve the picked relation's target table from its config blob.
  // Empty until the user actually selects a relation field — drives
  // the cascade behaviour for the target-field picker below.
  const selectedRelation = () => relationFields().find((f) => f.id === relationFieldId());
  const targetTableId = () => (selectedRelation()?.config as { targetTableId?: string } | undefined)?.targetTableId;

  // Target-table fields, filtered to scalar types — projecting a
  // lookup of a lookup or a relation-of-a-relation rarely renders
  // sensibly. Rollup follows the same filter (the agg aggregator
  // expects flat scalars too).
  const targetFields = () => {
    const id = targetTableId();
    if (!id) return [];
    return (props.fieldsByTable[id] ?? []).filter((f) => !f.deletedAt && !NON_PRESENTABLE_TYPES.has(f.type));
  };

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={relationFields().length > 0}
        fallback={
          <p class="text-xs text-amber-600 dark:text-amber-400">
            No relation fields on this table yet. Add a relation field first to enable {props.isRollup ? "rollup" : "lookup"}.
          </p>
        }
      >
        <Select
          label="Relation field"
          description="The relation on this table to follow."
          value={relationFieldId}
          // Reset targetFieldId when the relation changes — its old
          // value would point at fields on the previous target table.
          onChange={(v) => update({ relationFieldId: v || undefined, targetFieldId: undefined })}
          options={relationFields().map((f) => ({ id: f.id, label: f.name }))}
          placeholder="Pick a relation..."
          required
        />
      </Show>

      <Show when={selectedRelation() && !targetTableId()}>
        <p class="text-xs text-amber-600 dark:text-amber-400">
          The selected relation has no target table set yet. Configure that relation field first.
        </p>
      </Show>

      <Show when={targetTableId() && targetFields().length > 0}>
        <Select
          label="Target field"
          description="Which field on the linked table to project. Relation/lookup/rollup/formula fields are excluded — they'd nest or render unpredictably."
          value={targetFieldId}
          onChange={(v) => update({ targetFieldId: v || undefined })}
          options={targetFields().map((f) => ({ id: f.id, label: f.name }))}
          placeholder="Pick a field..."
          required
        />
      </Show>

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

function FileConstraints(props: { config: () => FieldConfigState; onChange: (next: FieldConfigState) => void }) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });
  const maxFiles = () => (typeof cfg().maxFiles === "number" ? String(cfg().maxFiles) : "10");
  const accept = () => (Array.isArray(cfg().accept) ? (cfg().accept as string[]).join(", ") : "");
  const setAccept = (items: string[]) => update({ accept: items.length > 0 ? items : undefined });
  const appendAccept = (items: string[]) => {
    const current = Array.isArray(cfg().accept) ? (cfg().accept as string[]) : [];
    setAccept([...new Set([...current, ...items])]);
  };

  return (
    <div class="grid grid-cols-1 gap-3">
      <NumberField
        label="Max files per record"
        value={maxFiles}
        min={1}
        max={100}
        onInput={(v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= 1 && n <= 100) update({ maxFiles: n });
        }}
      />
      <TextInput
        label="Accepted MIME types/extensions (optional)"
        description="Comma-separated. Empty accepts any file type."
        value={accept}
        onInput={(v) => {
          const items = v
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
          setAccept(items);
        }}
        placeholder="image/png, application/pdf, .txt"
      />
      <div class="flex flex-wrap gap-1.5">
        <For each={FILE_ACCEPT_PRESETS}>
          {(preset) => (
            <button
              type="button"
              class="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-secondary hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              onClick={() => appendAccept(preset.values)}
            >
              {preset.label}
            </button>
          )}
        </For>
      </div>
      <p class="text-xs text-dimmed leading-snug">The global per-file size limit is managed from the Grids admin settings.</p>
    </div>
  );
}

function FormulaConstraints(props: {
  config: () => FieldConfigState;
  onChange: (next: FieldConfigState) => void;
  fields: Field[];
  currentTableId: string;
  currentFieldId?: string;
  baseShortId?: string;
  tableShortId?: string;
}) {
  const cfg = () => props.config();
  const expr = () => (typeof cfg().expression === "string" ? (cfg().expression as string) : "");
  const refs = () => formulaFieldRefs(props.fields, props.currentFieldId);
  const completions = () => buildFormulaCompletions(refs());
  const referenceHref = () => {
    if (!props.baseShortId || !props.tableShortId) return null;
    const params = props.currentFieldId ? `?field=${encodeURIComponent(props.currentFieldId)}` : "";
    return `/app/grids/${encodeURIComponent(props.baseShortId)}/table/${encodeURIComponent(props.tableShortId)}/formula-reference${params}`;
  };
  const openReference = () => {
    const href = referenceHref();
    if (!href || typeof window === "undefined") return;
    window.open(href, "grids-formula-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
  };
  const numericRefs = () => refs().filter((field) => ["number", "percent", "duration", "rollup", "formula"].includes(field.type));
  const textRefs = () => refs().filter((field) => ["text", "longtext", "select", "autonumber", "lookup", "formula"].includes(field.type));
  const dateRefs = () => refs().filter((field) => ["date", "created_at", "updated_at", "formula"].includes(field.type));
  const boolRefs = () => refs().filter((field) => ["boolean", "formula"].includes(field.type));
  const refOr = (list: ReturnType<typeof refs>, fallback: string) => (list[0] ? formulaFieldToken(list[0]) : fallback);
  const examples = () => {
    const price = refOr(numericRefs(), "#price");
    const qty = refOr(numericRefs().slice(1), "#qty");
    const name = refOr(textRefs(), "#name");
    const date = refOr(dateRefs(), "#date");
    const active = refOr(boolRefs(), "#active");
    return [
      { label: "Markup", expression: `${price} * 1.19` },
      { label: "Total", expression: `${price} * ${qty}` },
      { label: "Text label", expression: `CONCAT(UPPER(${name}), " - EUR ", ${price})` },
      { label: "Conditional", expression: `IF(${active}, "Available", "Out of stock")` },
      { label: "Date age", expression: `DATEDIFF(${date}, TODAY(), "days")` },
    ];
  };
  const [preview, setPreview] = createSignal<FormulaPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  let previewToken = 0;
  const loadPreview = async (expression: string) => {
    const token = ++previewToken;
    if (!expression.trim()) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await apiClient.formulas["by-table"][":tableId"].check.$post({
        param: { tableId: props.currentTableId },
        json: { expression, currentFieldId: props.currentFieldId ?? null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not preview formula."));
      const data = await res.json();
      if (token === previewToken) setPreview(data);
    } catch (error) {
      if (token === previewToken) {
        setPreview({
          ok: false,
          diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : "Could not preview formula." }],
          fields: [],
          rows: [],
        });
      }
    } finally {
      if (token === previewToken) setPreviewLoading(false);
    }
  };
  const previewDebounce = timed.debounce(loadPreview, 300);
  createEffect(() => {
    previewDebounce.debouncedFn(expr());
  });
  return (
    <div class="flex flex-col gap-3">
      <div class="info-block-info text-xs flex flex-col gap-2">
        <span class="font-medium">Formula basics</span>
        <span class="text-dimmed">
          Search fields by name, then insert the suggested reference. Formulas store stable refs like <code>#aB3kQ</code>, so renaming a field
          does not break saved formulas.
        </span>
        <span class="text-dimmed">
          Numbers and decimals calculate with decimal-safe arithmetic when exact values are involved. Empty values stay empty; formula errors render
          as <code>#ERROR</code>.
        </span>
      </div>

      <div class="info-block-info text-xs flex flex-col gap-2">
        <span class="font-medium">Examples</span>
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <For each={examples()}>
            {(example) => (
              <button
                type="button"
                class="rounded border border-blue-200/70 bg-white/60 px-2 py-1.5 text-left transition hover:border-blue-300 hover:bg-white dark:border-blue-900/60 dark:bg-zinc-950/30 dark:hover:border-blue-800"
                onClick={() => props.onChange({ ...cfg(), expression: example.expression })}
              >
                <span class="block text-[11px] font-medium text-secondary">{example.label}</span>
                <code class="block truncate font-mono text-[11px] text-dimmed">{example.expression}</code>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-label text-xs">Expression</span>
        <AutocompleteEditor
          value={expr}
          onInput={(v) => props.onChange({ ...cfg(), expression: v })}
          placeholder="Reference fields with #, call functions by name. Leading = is optional."
          completions={completions()}
          highlight={formulaHighlight}
          restoreExpansionOnBackspace={false}
          lines={4}
          ariaLabel="Formula expression"
        />
      </div>

      <p class="text-xs text-dimmed leading-snug">
        Formulas recompute on every read. Field suggestions show names, but insert stable <code>#ref</code> values.
      </p>

      <div class="flex flex-col gap-2">
        <FormulaPreview preview={preview()} loading={previewLoading()} />
        <Show when={referenceHref()}>
          <button type="button" class="btn-input btn-sm w-fit" onClick={openReference}>
            <i class="ti ti-external-link" /> Open reference
          </button>
        </Show>
      </div>
    </div>
  );
}

type FormulaPreviewResponse = {
  ok: boolean;
  diagnostics: { severity: "error" | "info"; message: string }[];
  fields: { id: string; shortId: string; name: string; type: string }[];
  rows: { recordId: string; values: Record<string, unknown>; result: unknown }[];
};

const previewValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(previewValue).join(", ");
  return JSON.stringify(value);
};

function FormulaPreview(props: { preview: FormulaPreviewResponse | null; loading: boolean }) {
  const columns = (): DataTableColumn<FormulaPreviewResponse["rows"][number]>[] => {
    const preview = props.preview;
    if (!preview) return [];
    return [
      ...preview.fields.map((field) => ({
        id: field.id,
        header: field.name,
        subtitle: `#${field.shortId}`,
        value: (row: FormulaPreviewResponse["rows"][number]) => row.values[field.id],
      })),
      {
        id: "result",
        header: "Result",
        value: (row: FormulaPreviewResponse["rows"][number]) => row.result,
        headerClass: "text-primary",
      },
    ];
  };

  return (
    <div class="flex flex-col gap-2 text-xs">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium text-secondary">Formula preview</span>
        <Show when={props.loading}>
          <span class="inline-flex items-center gap-1 text-[11px] text-dimmed">
            <i class="ti ti-loader-2 animate-spin" /> Checking
          </span>
        </Show>
      </div>

      <Show when={props.preview} fallback={<p class="text-dimmed">Type a formula to preview the latest records.</p>}>
        {(preview) => (
          <div class="flex flex-col gap-2">
            <Show when={preview().diagnostics.length > 0}>
              <div class={preview().ok ? "info-block-info py-1.5 text-[11px]" : "info-block-error py-1.5 text-[11px]"}>
                <For each={preview().diagnostics}>{(diagnostic) => <div>{diagnostic.message}</div>}</For>
              </div>
            </Show>

            <Show
              when={preview().rows.length > 0}
              fallback={<Show when={preview().ok}>{<p class="text-dimmed">No records to preview yet.</p>}</Show>}
            >
              <DataTable
                rows={preview().rows}
                columns={columns()}
                getRowId={(row) => row.recordId}
                class="max-h-48 overflow-auto"
                tableClass="w-full text-[11px]"
                density="compact"
                stickyHeader={false}
                hoverRows={false}
                cellContentClass="max-w-40 whitespace-nowrap"
                renderCell={({ col, value }) => (
                  <span
                    class={
                      col.id === "result" && typeof value === "string" && value.startsWith("#")
                        ? "font-medium text-red-600 dark:text-red-400"
                        : col.id === "result"
                          ? "font-medium text-secondary"
                          : "text-dimmed"
                    }
                  >
                    {previewValue(value)}
                  </span>
                )}
              />
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

// =============================================================================
// Tiny shared input helper
// =============================================================================

/**
 * Thin wrapper around the platform NumberInput that keeps the legacy
 * string-based call signature used throughout this file. Each call
 * site computes its config string-side; we translate to/from number
 * here so the constraint forms keep their existing per-field
 * validation logic without rewriting.
 */
function NumberField(props: { label: string; value: () => string; onInput: (v: string) => void; min?: number; max?: number }) {
  const numericValue = () => {
    const raw = props.value();
    if (raw === "" || raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return (
    <NumberInput
      label={props.label}
      value={numericValue}
      onInput={(v) => props.onInput(Number.isFinite(v) ? String(v) : "")}
      min={props.min}
      max={props.max}
    />
  );
}
