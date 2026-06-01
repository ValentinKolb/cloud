import { Checkbox, CheckboxCard, DateTimeInput, NumberInput, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import type { Field, FormFieldEntry } from "../../../service";
import RelationPicker from "../records/RelationPicker";

/** A user_input form-field entry — `form_value` entries don't render. */
export type UserInputEntry = Extract<FormFieldEntry, { kind: "user_input" }>;

/** Filter a form-config's entries to the user-renderable subset. */
export const userInputEntriesOf = (entries: FormFieldEntry[]): UserInputEntry[] =>
  entries.filter((e): e is UserInputEntry => e.kind === "user_input");

/**
 * Build the initial value map from a list of user-input entries —
 * seeded with each entry's `defaultValue` when present.
 */
export const buildInitialValues = (entries: UserInputEntry[]): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const entry of entries) {
    if (
      entry.defaultValue !== undefined &&
      entry.defaultValue !== null &&
      !(typeof entry.defaultValue === "object" && (entry.defaultValue as { kind?: unknown }).kind === "now")
    ) {
      values[entry.fieldId] = entry.defaultValue;
    }
  }
  return values;
};

/**
 * Renders one input row for a grids field. Single source of truth across
 * every record-write surface (public form submit, in-app form modal,
 * create-record dialog, default-value editor in the field designer).
 *
 * Why this matters: rendering used to fork between FormSubmit (here) and
 * `RecordUpsertDialog`. Numeric fields must preserve exact decimal text;
 * select was stacked
 * CheckboxCards here and a freeform `TagsInput` there (which let users type
 * non-existent option ids that the server rejected). Post-cleanup #7
 * collapses both onto this renderer so users see the same widget for the
 * same field type everywhere.
 *
 * Field-type → component mapping (current):
 * - text / unknown → TextInput
 * - longtext → TextInput multiline
 * - json → TextInput multiline (lines=6)
 * - number → TextInput with decimal keyboard hint (server validates exactly)
 * - percent → NumberInput
 * - duration → TextInput with "HH:MM:SS or seconds"; same lenient parser
 *   server-side. NumberInput would lose the HH:MM:SS shorthand.
 * - boolean → Checkbox
 * - date → DateTimeInput dateOnly (or full datetime when config.includeTime)
 * - datetime → DateTimeInput
 * - select → SelectInput in single mode, CheckboxCard list in multi mode
 * - relation → RelationPicker (requires `baseId` prop). Picker disabled
 *   without baseId — used by the default-value editor where deep-link
 *   chips don't apply.
 *
 * Optional `error` getter (function form, so the platform components
 * react to signal updates) renders the inline error string. Mirrors
 * the rest of the platform's input convention.
 */
export function FieldInput(props: {
  field: Field;
  entry: UserInputEntry;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Render an inline error string. Reactive on purpose. */
  error?: () => string | undefined;
  /** Required for relation rendering — drives RelationPicker chip
   *  deep-links. Omitted for the field designer's default-value editor;
   *  RelationPicker degrades to a non-deep-linkable picker there. */
  baseId?: string;
  /** Optional UUID → label map for already-linked relation values. */
  relationLabels?: Record<string, string>;
}) {
  const label = props.entry.label || props.field.name;
  const required = props.entry.required ?? props.field.required;
  const helpText = props.entry.helpText;
  const error = () => props.error?.();

  // Helpers narrowing the unknown value to a usable shape per input
  // type. Each input is forgiving — a wrong-typed stored value falls
  // back to empty, never throws.
  const stringValue = () => (typeof props.value === "string" ? props.value : typeof props.value === "number" ? String(props.value) : "");
  const numberValue = () => (typeof props.value === "number" ? props.value : undefined);
  const boolValue = () => props.value === true;
  const arrayValue = (): string[] => (Array.isArray(props.value) ? (props.value as string[]) : []);

  switch (props.field.type) {
    case "longtext":
      const markdown = Boolean((props.field.config as { markdown?: boolean }).markdown);
      return (
        <TextInput
          name={props.field.id}
          label={label}
          description={helpText}
          required={required}
          markdown={markdown || undefined}
          multiline={markdown ? undefined : true}
          lines={markdown ? 8 : 4}
          value={stringValue}
          onInput={(v) => props.onChange(v)}
          onChange={(v) => props.onChange(v)}
          error={error}
        />
      );

    case "json":
      // JSON is a freeform blob — the server stores it as-is in
      // `records.data->fieldId`. We don't validate JSON shape client-
      // side; the server's `jsonHandler` does. Multiline-6 keeps the
      // box tall enough that the user can see the structure as they
      // type without running off the visible area.
      return (
        <TextInput
          name={props.field.id}
          label={label}
          description={helpText}
          required={required}
          multiline
          lines={6}
          value={stringValue}
          onInput={(v) => props.onChange(v)}
          onChange={(v) => props.onChange(v)}
          error={error}
        />
      );

    case "number": {
      const decimalPlaces = (props.field.config as { decimalPlaces?: number; scale?: number }).decimalPlaces
        ?? (props.field.config as { scale?: number }).scale;
      const unit = (props.field.config as { unit?: string }).unit;
      const unitPosition = (props.field.config as { unitPosition?: "prefix" | "suffix" }).unitPosition ?? "suffix";
      const numberText = (): string => {
        const v = props.value;
        if (v === null || v === undefined) return "";
        if (typeof v === "object" && "amount" in v) return String((v as { amount?: unknown }).amount ?? "");
        return String(v);
      };
      return (
        <TextInput
          name={props.field.id}
          label={label}
          description={helpText}
          required={required}
          value={numberText}
          onInput={(v) => props.onChange(v)}
          onChange={(v) => props.onChange(v)}
          inputMode={decimalPlaces === 0 ? "numeric" : "decimal"}
          icon="ti ti-number"
          prefix={unit && unitPosition === "prefix" ? <span class="font-mono">{unit}</span> : undefined}
          suffix={unit && unitPosition !== "prefix" ? <span class="font-mono">{unit}</span> : undefined}
          clearable={!required}
          error={error}
        />
      );
    }

    case "percent":
      return (
        <NumberInput
          label={label}
          description={helpText}
          required={required}
          min={0}
          max={100}
          value={numberValue}
          onInput={(v) => props.onChange(v)}
          decimalPlaces={0}
          suffix={<span class="font-mono">%</span>}
          error={error}
        />
      );

    case "duration":
      // Duration accepts either seconds ("90") or "HH:MM:SS" / "MM:SS".
      // TextInput preserves the shorthand; NumberInput would force
      // the user to compute seconds.
      return (
        <TextInput
          name={props.field.id}
          label={label}
          description={helpText}
          required={required}
          placeholder="HH:MM:SS or seconds"
          value={stringValue}
          onInput={(v) => props.onChange(v)}
          onChange={(v) => props.onChange(v)}
          error={error}
        />
      );

    case "boolean":
      return (
        <Checkbox
          label={label}
          description={helpText}
          required={required}
          value={boolValue}
          onChange={(v) => props.onChange(v)}
          error={error}
        />
      );

    case "date": {
      const includeTime = (props.field.config as { includeTime?: boolean }).includeTime ?? false;
      return (
        <DateTimeInput
          label={label}
          description={helpText}
          required={required}
          dateOnly={!includeTime}
          value={stringValue}
          onChange={(v) => props.onChange(v)}
          error={error}
        />
      );
    }

    case "datetime":
      return (
        <DateTimeInput
          label={label}
          description={helpText}
          required={required}
          value={stringValue}
          onChange={(v) => props.onChange(v)}
          error={error}
        />
      );

    case "select": {
      const multiple = Boolean((props.field.config as { multiple?: boolean }).multiple);
      const optionCards =
        (props.field.config as { options?: Array<{ id: string; label: string; description?: string; color?: string }> }).options ?? [];
      if (multiple) {
        const isSelected = (id: string) => arrayValue().includes(id);
        const toggle = (id: string, checked: boolean) => {
          const current = arrayValue();
          const next = checked ? (current.includes(id) ? current : [...current, id]) : current.filter((s) => s !== id);
          props.onChange(next);
        };
        return (
          <div class="flex flex-col gap-2">
            <p class="text-sm font-medium">
              {label}
              <Show when={required}>
                <span class="ml-0.5 text-red-500" aria-hidden="true">
                  *
                </span>
              </Show>
            </p>
            <Show when={helpText}>
              <p class="text-xs text-dimmed">{helpText}</p>
            </Show>
            <div class="grid grid-cols-1 gap-2">
              <For each={optionCards}>
                {(option) => (
                  <CheckboxCard
                    label={option.label}
                    description={option.description}
                    color={option.color}
                    value={() => isSelected(option.id)}
                    onChange={(checked) => toggle(option.id, checked)}
                  />
                )}
              </For>
            </div>
            <Show when={error()}>
              <p class="text-[11px] text-red-500">{error()}</p>
            </Show>
          </div>
        );
      }
      return (
        <SelectInput
          label={label}
          description={helpText}
          required={required}
          options={optionCards.map((o) => ({ id: o.id, label: o.label, description: o.description }))}
          clearable={!required}
          value={() => arrayValue()[0] ?? ""}
          onChange={(v) => props.onChange(v ? [v] : null)}
          error={error}
        />
      );
    }

    case "relation": {
      // Relation rendering: RelationPicker resolves linked records
      // against `targetTableId`. Without `baseId` we still render the
      // picker (server-side validation guards against bad ids); chip
      // deep-links degrade to "open in records view" using a placeholder
      // — non-fatal since the most common no-baseId surface is the
      // field-designer's default-value editor where deep-links don't apply.
      const cfg = props.field.config as {
        targetTableId?: string;
        cardinality?: "single" | "multiple";
      };
      if (!cfg.targetTableId) {
        return (
          <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-secondary">{label}</span>
            <p class="text-xs text-amber-600 dark:text-amber-400">Relation has no target table configured — skipping.</p>
          </div>
        );
      }
      const multi = cfg.cardinality !== "single";
      return (
        <div class="flex flex-col gap-0.5">
          <span class="text-xs font-medium text-secondary">
            {label}
            <Show when={required}>
              <span class="ml-0.5 text-red-500" aria-hidden="true">
                *
              </span>
            </Show>
          </span>
          <Show when={helpText}>
            <p class="text-[11px] text-dimmed leading-snug">{helpText}</p>
          </Show>
          <RelationPicker
            targetTableId={cfg.targetTableId}
            multi={multi}
            value={() => arrayValue()}
            labels={() => props.relationLabels ?? {}}
            onChange={(v) => props.onChange(v)}
          />
          <Show when={error()}>
            <p class="text-[11px] text-red-500">{error()}</p>
          </Show>
        </div>
      );
    }

    default:
      // text / unknown-but-userInput → plain text.
      return (
        <TextInput
          name={props.field.id}
          label={label}
          description={helpText}
          required={required}
          value={stringValue}
          onInput={(v) => props.onChange(v)}
          onChange={(v) => props.onChange(v)}
          error={error}
        />
      );
  }
}
