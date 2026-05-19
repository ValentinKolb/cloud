import { AutocompleteEditor, CheckboxCard, ColorInput, CopyButton, NumberInput, Select, TextInput } from "@valentinkolb/cloud/ui";
import { For, Index, Show } from "solid-js";
import type { Field } from "../../../service";
import { buildFormulaCompletions, formulaFieldRefs, formulaHighlight, GRID_FORMULA_FUNCTIONS } from "./formula-authoring";

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
  { value: "decimal", label: "Decimal (money-safe)" },
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
  number: 'A number. Set min and max to bound the range; tick "integer only" to reject decimals.',
  decimal:
    "Use this for money or anything where rounding matters. Precision is how many digits the value can have in total; Scale is how many of those come after the decimal point.",
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
    case "decimal":
      return { precision: 10, scale: 2 };
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
  type: string;
  /** ID of the table this field lives on. Needed by lookup/rollup so
   *  the relation-field picker can list THIS table's relation fields. */
  currentTableId: string;
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
  "decimal",
  "date",
  "select",
  "autonumber",
  "relation",
  "lookup",
  "rollup",
  "formula",
  "file",
]);

const FORMULA_EXAMPLES: Record<string, string> = {
  SUM: "SUM(#Pr1cE, #Qty01)",
  AVG: "AVG(#Pr1cE, #Qty01)",
  MEAN: "MEAN(#Pr1cE, #Qty01)",
  COUNT: 'COUNT(#Pr1cE, "", #Qty01)',
  MIN: "MIN(#Pr1cE, #Qty01)",
  MAX: "MAX(#Pr1cE, #Qty01)",
  MEDIAN: "MEDIAN(#Pr1cE, #Qty01)",
  ABS: "ABS(#Pr1cE)",
  ROUND: "ROUND(#Pr1cE, 2)",
  FLOOR: "FLOOR(#Pr1cE)",
  CEIL: "CEIL(#Pr1cE)",
  SQRT: "SQRT(#Qty01)",
  POW: "POW(#Qty01, 2)",
  MOD: "MOD(#Qty01, 2)",
  PERCENT: "PERCENT(#Done1, #Total)",
  IF: 'IF(#Qty01 > 0, "Available", "Out")',
  IFEMPTY: 'IFEMPTY(#Notes, "No notes")',
  IFERROR: "IFERROR(#Total / #Qty01, 0)",
  AND: "AND(#Active, #Qty01 > 0)",
  OR: "OR(#Active, #Qty01 > 0)",
  NOT: "NOT(#Active)",
  ISBLANK: "ISBLANK(#Notes)",
  CONTAINS: 'CONTAINS(#Name1, "Pro")',
  CONCAT: 'CONCAT(#Name1, " — ", #Pr1cE)',
  LEN: "LEN(#Name1)",
  LOWER: "LOWER(#Name1)",
  UPPER: "UPPER(#Name1)",
  TRIM: "TRIM(#Name1)",
  LEFT: "LEFT(#Name1, 3)",
  RIGHT: "RIGHT(#Name1, 3)",
  SUBSTRING: "SUBSTRING(#Name1, 1, 3)",
  REPLACE: 'REPLACE(#Name1, "old", "new")',
  TODAY: "TODAY()",
  NOW: "NOW()",
  YEAR: "YEAR(#Date1)",
  MONTH: "MONTH(#Date1)",
  DAY: "DAY(#Date1)",
  DATEADD: 'DATEADD(#Date1, 7, "days")',
  DATEDIFF: 'DATEDIFF(#Date1, TODAY(), "days")',
};

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
      <Show when={props.type === "decimal"}>
        <DecimalConstraints config={props.config} onChange={props.onChange} />
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
        <FormulaConstraints config={props.config} onChange={props.onChange} fields={props.fieldsByTable[props.currentTableId] ?? []} />
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

  const min = () => (typeof cfg().min === "number" ? String(cfg().min) : "");
  const max = () => (typeof cfg().max === "number" ? String(cfg().max) : "");
  const integerOnly = () => Boolean(cfg().integerOnly);

  // TextInput (not NumberField) for the same reason as TextConstraints —
  // optional needs a clearable empty state. Accepts decimals here
  // because the field type is "number", not integer-only.
  const onBound = (key: "min" | "max", v: string) => {
    const t = v.trim();
    if (t === "") return update({ [key]: undefined });
    const n = Number(t);
    if (!Number.isFinite(n)) return;
    update({ [key]: n });
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
      <div class="col-span-2">
        <CheckboxCard
          label="Integer only"
          description="Reject decimal values for this field."
          icon="ti ti-number"
          value={integerOnly}
          onChange={(checked) => update({ integerOnly: checked || undefined })}
        />
      </div>
    </div>
  );
}

function DecimalConstraints(props: { config: () => FieldConfigState; onChange: (next: FieldConfigState) => void }) {
  const cfg = () => props.config();
  const update = (patch: FieldConfigState) => props.onChange({ ...cfg(), ...patch });

  const precision = () => (typeof cfg().precision === "number" ? String(cfg().precision) : "10");
  const scale = () => (typeof cfg().scale === "number" ? String(cfg().scale) : "2");
  const min = () => (typeof cfg().min === "string" ? (cfg().min as string) : "");
  const max = () => (typeof cfg().max === "string" ? (cfg().max as string) : "");
  const unit = () => (typeof cfg().unit === "string" ? (cfg().unit as string) : "");
  const unitPosition = () => (cfg().unitPosition === "prefix" ? "prefix" : "suffix");

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
        description="Empty = no minimum."
        value={min}
        onInput={(v) => update({ min: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. 0"
      />
      <TextInput
        label="Max (optional)"
        description="Empty = no maximum."
        value={max}
        onInput={(v) => update({ max: v.trim() === "" ? undefined : v.trim() })}
        placeholder="e.g. 9999.99"
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

function FormulaConstraints(props: { config: () => FieldConfigState; onChange: (next: FieldConfigState) => void; fields: Field[] }) {
  const cfg = () => props.config();
  const expr = () => (typeof cfg().expression === "string" ? (cfg().expression as string) : "");
  const refs = () => formulaFieldRefs(props.fields);
  const completions = () => buildFormulaCompletions(refs());
  return (
    <div class="flex flex-col gap-3">
      {/* Quick-start examples — concrete first, theory second. Most
          users grok formulas faster from a working snippet than from a
          function list. */}
      <div class="info-block-info text-xs flex flex-col gap-2">
        <span class="font-medium">Examples</span>
        <span class="text-dimmed">
          Slugs below (<code>#aB3kQ</code> etc.) are placeholders — paste your field's real <code>#slug</code> via the <em>Copy ref</em>{" "}
          button on a field row.
        </span>
        <div class="flex flex-col gap-1.5 font-mono text-[11px]">
          <div>
            <span class="text-dimmed">— Mark up by 19%:</span>
            <br />
            <code>{"#aB3kQ * 1.19"}</code>
          </div>
          <div>
            <span class="text-dimmed">— Format with prefix:</span>
            <br />
            <code>{`CONCAT(UPPER(#xY7mP), " — €", #aB3kQ)`}</code>
          </div>
          <div>
            <span class="text-dimmed">— Conditional label:</span>
            <br />
            <code>{`IF(#7n2Lk, "Available", "Out of stock")`}</code>
          </div>
          <div>
            <span class="text-dimmed">— Days since created:</span>
            <br />
            <code>{`DATEDIFF(TODAY(), #Pq4tD, "days")`}</code>
          </div>
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
          lines={4}
          ariaLabel="Formula expression"
        />
      </div>

      <p class="text-xs text-dimmed leading-snug">
        Formulas recompute on every read. Cycles render as <code>#CYCLE</code>.
      </p>

      {/* Function reference — collapsed by default to keep the editor
          tidy. Each entry: signature · description · example. */}
      <details class="text-xs">
        <summary class="cursor-pointer select-none text-secondary font-medium py-1">Function reference</summary>
        <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
          <For each={GRID_FORMULA_FUNCTIONS}>
            {(fn) => <FormulaFn sig={fn.signature} desc={fn.description} example={FORMULA_EXAMPLES[fn.name] ?? fn.signature} />}
          </For>
        </div>
      </details>

      <div class="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
        <div class="grid grid-cols-[1fr_6rem_7rem_2rem] gap-2 bg-zinc-50 px-2 py-1.5 text-[11px] font-semibold uppercase text-dimmed dark:bg-zinc-900">
          <span>Name</span>
          <span>Type</span>
          <span>ID</span>
          <span />
        </div>
        <div class="max-h-44 overflow-auto">
          <For each={refs()}>
            {(field) => (
              <div class="grid grid-cols-[1fr_6rem_7rem_2rem] items-center gap-2 px-2 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                <span class="truncate text-secondary">{field.name}</span>
                <span class="truncate text-dimmed">{TYPE_LABELS[field.type] ?? field.type}</span>
                <code class="truncate text-[11px] text-primary">#{field.shortId}</code>
                <CopyButton text={`#${field.shortId}`} class="icon-btn h-6 w-6 text-dimmed hover:text-primary" />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

/** Single function-doc row inside the Formula reference grid. */
function FormulaFn(props: { sig: string; desc: string; example: string }) {
  return (
    <div class="flex flex-col gap-0.5">
      <code class="font-mono text-secondary">{props.sig}</code>
      <span class="text-dimmed leading-snug">{props.desc}</span>
      <code class="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{props.example}</code>
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
