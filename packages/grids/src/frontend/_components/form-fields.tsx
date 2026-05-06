import {
  Checkbox,
  DateTimeInput,
  NumberInput,
  SelectInput,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import type { Field, FormFieldEntry } from "../../service";

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
    if (entry.defaultValue !== undefined && entry.defaultValue !== null) {
      values[entry.fieldId] = entry.defaultValue;
    }
  }
  return values;
};

/**
 * Renders one input row for a form-field entry. Picks the appropriate
 * platform component by `field.type`; never falls back to raw HTML
 * elements — every visible input is a platform component so styling +
 * a11y stay consistent across the cloud.
 *
 * Field-type → component mapping:
 * - text / slug / barcode / isbn / unknown → TextInput
 * - longtext → TextInput multiline
 * - email / url / phone → TextInput with type + icon
 * - number / decimal / rating / currency / percent / duration → NumberInput
 * - boolean → Checkbox
 * - date → DateTimeInput dateOnly
 * - datetime → DateTimeInput
 * - single-select → SelectInput
 * - multi-select → stacked Checkbox per option (only platform multi-pick primitive)
 *
 * Shared between the public `PublicFormSubmit` page and the in-app
 * `FormSubmitModal` so both surfaces look + behave identically.
 */
export function FieldInput(props: {
  field: Field;
  entry: UserInputEntry;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = props.entry.label || props.field.name;
  const required = props.entry.required ?? props.field.required;
  const helpText = props.entry.helpText;

  // Helpers narrowing the unknown value to a usable shape per input
  // type. Each input is forgiving — a wrong-typed stored value falls
  // back to empty, never throws.
  const stringValue = () =>
    typeof props.value === "string"
      ? props.value
      : typeof props.value === "number"
        ? String(props.value)
        : "";
  const numberValue = () =>
    typeof props.value === "number" ? props.value : undefined;
  const boolValue = () => props.value === true;
  const arrayValue = (): string[] =>
    Array.isArray(props.value) ? (props.value as string[]) : [];

  switch (props.field.type) {
    case "longtext":
      return (
        <TextInput
          label={label}
          description={helpText}
          required={required}
          multiline
          value={stringValue}
          onInput={(v) => props.onChange(v)}
        />
      );

    case "email":
      return (
        <TextInput
          label={label}
          description={helpText}
          required={required}
          type="email"
          icon="ti ti-mail"
          value={stringValue}
          onInput={(v) => props.onChange(v)}
        />
      );

    case "url":
      return (
        <TextInput
          label={label}
          description={helpText}
          required={required}
          type="url"
          icon="ti ti-link"
          value={stringValue}
          onInput={(v) => props.onChange(v)}
        />
      );

    case "phone":
      return (
        <TextInput
          label={label}
          description={helpText}
          required={required}
          type="tel"
          icon="ti ti-phone"
          value={stringValue}
          onInput={(v) => props.onChange(v)}
        />
      );

    case "number":
    case "decimal":
    case "rating":
    case "currency":
    case "percent":
    case "duration":
      return (
        <NumberInput
          label={label}
          description={helpText}
          required={required}
          value={numberValue}
          onInput={(v) => props.onChange(v)}
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
        />
      );

    case "date":
      return (
        <DateTimeInput
          label={label}
          description={helpText}
          required={required}
          dateOnly
          value={stringValue}
          onChange={(v) => props.onChange(v)}
        />
      );

    case "datetime":
      return (
        <DateTimeInput
          label={label}
          description={helpText}
          required={required}
          value={stringValue}
          onChange={(v) => props.onChange(v)}
        />
      );

    case "single-select": {
      const options =
        ((props.field.config as { options?: Array<{ id: string; label: string }> })
          .options ?? []).map((o) => ({ id: o.id, label: o.label }));
      return (
        <SelectInput
          label={label}
          description={helpText}
          required={required}
          options={options}
          clearable={!required}
          value={stringValue}
          onChange={(v) => props.onChange(v || null)}
        />
      );
    }

    case "multi-select": {
      // Stacked Checkboxes — one row per option. The platform Checkbox
      // is the only multi-pick primitive available; SelectInput is
      // single-pick, TagsInput is freeform, SelectChip is single-pick
      // chip. A wrapped group keeps everything inside the platform's
      // input vocabulary.
      const options =
        (props.field.config as { options?: Array<{ id: string; label: string }> })
          .options ?? [];
      const isSelected = (id: string) => arrayValue().includes(id);
      const toggle = (id: string, checked: boolean) => {
        const current = arrayValue();
        const next = checked
          ? current.includes(id)
            ? current
            : [...current, id]
          : current.filter((s) => s !== id);
        props.onChange(next);
      };
      return (
        <div class="flex flex-col gap-1">
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
          <div class="flex flex-col gap-1">
            <For each={options}>
              {(option) => (
                <Checkbox
                  label={option.label}
                  value={() => isSelected(option.id)}
                  onChange={(checked) => toggle(option.id, checked)}
                />
              )}
            </For>
          </div>
        </div>
      );
    }

    default:
      // text / slug / barcode / isbn / unknown-but-userInput → plain text.
      return (
        <TextInput
          label={label}
          description={helpText}
          required={required}
          value={stringValue}
          onInput={(v) => props.onChange(v)}
        />
      );
  }
}
