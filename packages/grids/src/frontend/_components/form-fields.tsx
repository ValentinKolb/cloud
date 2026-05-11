import {
  Checkbox,
  CurrencyInput,
  type CurrencyValue,
  DateTimeInput,
  NumberInput,
  SelectInput,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import type { Field, FormFieldEntry } from "../../service";
import RelationPicker from "./RelationPicker";

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
 * Renders one input row for a grids field. Single source of truth across
 * every record-write surface (public form submit, in-app form modal,
 * create-record dialog, default-value editor in the field designer).
 *
 * Why this matters: rendering used to fork between FormSubmit (here) and
 * `CreateRecordDialog`. Currency was a `NumberInput` here and a TextInput
 * with a "12.34 EUR" placeholder there; multi-select was stacked
 * Checkboxes here and a freeform `TagsInput` there (which let users type
 * non-existent option ids that the server rejected). Post-cleanup #7
 * collapses both onto this renderer so users see the same widget for the
 * same field type everywhere.
 *
 * Field-type → component mapping (current):
 * - text / slug / barcode / isbn / unknown → TextInput
 * - longtext → TextInput multiline
 * - json → TextInput multiline (lines=6)
 * - email / url / phone → TextInput with type + icon
 * - number / decimal / rating / percent → NumberInput
 * - currency → TextInput with "12.34 EUR" placeholder; the server's
 *   `currencyHandler` accepts both "12.34" (default currency wraps) and
 *   "12.34 EUR" (per-row override). NumberInput would lose the override.
 * - duration → TextInput with "HH:MM:SS or seconds"; same lenient parser
 *   server-side. NumberInput would lose the HH:MM:SS shorthand.
 * - boolean → Checkbox
 * - date → DateTimeInput dateOnly (or full datetime when config.includeTime)
 * - datetime → DateTimeInput
 * - single-select → SelectInput
 * - multi-select → stacked Checkbox per option (the only platform multi-pick
 *   primitive that constrains input to declared options)
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
}) {
  const label = props.entry.label || props.field.name;
  const required = props.entry.required ?? props.field.required;
  const helpText = props.entry.helpText;
  const error = () => props.error?.();

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
          lines={4}
          value={stringValue}
          onInput={(v) => props.onChange(v)}
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
          label={label}
          description={helpText}
          required={required}
          multiline
          lines={6}
          value={stringValue}
          onInput={(v) => props.onChange(v)}
          error={error}
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
          error={error}
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
          error={error}
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
          error={error}
        />
      );

    case "number":
    case "decimal":
      return (
        <NumberInput
          label={label}
          description={helpText}
          required={required}
          value={numberValue}
          onInput={(v) => props.onChange(v)}
          error={error}
        />
      );

    case "rating": {
      const scale = (props.field.config as { scale?: number }).scale ?? 5;
      return (
        <NumberInput
          label={label}
          description={helpText}
          required={required}
          min={0}
          max={scale}
          value={numberValue}
          onInput={(v) => props.onChange(v)}
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
          error={error}
        />
      );

    case "currency": {
      // Currency: real paired amount + currency-code picker via
      // CurrencyInput. The platform widget emits `{amount, currency}`
      // which matches the server-side `currencyHandler` storage shape
      // exactly — no string parsing required. Tolerates legacy stored
      // values (raw number or `"12.34 EUR"` string) by coercing on
      // read so existing records render correctly.
      const defaultCcy =
        (props.field.config as { defaultCurrency?: string }).defaultCurrency ?? "EUR";
      const currencyValue = (): CurrencyValue | null => {
        const v = props.value;
        if (v === null || v === undefined || v === "") return null;
        if (typeof v === "object") {
          const obj = v as { amount?: unknown; currency?: unknown };
          const amountNum =
            typeof obj.amount === "number"
              ? obj.amount
              : typeof obj.amount === "string"
                ? Number(obj.amount)
                : NaN;
          const code = typeof obj.currency === "string" && obj.currency.length > 0
            ? obj.currency.toUpperCase()
            : defaultCcy;
          return Number.isFinite(amountNum)
            ? { amount: amountNum, currency: code }
            : null;
        }
        if (typeof v === "number") return { amount: v, currency: defaultCcy };
        if (typeof v === "string") {
          // Tolerate "12.34" or "12.34 EUR" — same shapes the server
          // `currencyHandler` accepts as input. The Select picks up
          // the currency token if present.
          const m = /^(-?\d+(?:\.\d+)?)\s*([A-Za-z]{3})?$/.exec(v.trim());
          if (m) {
            const amount = Number(m[1]);
            const code = (m[2] ?? defaultCcy).toUpperCase();
            return Number.isFinite(amount) ? { amount, currency: code } : null;
          }
        }
        return null;
      };
      return (
        <CurrencyInput
          label={label}
          description={helpText}
          required={required}
          value={currencyValue}
          defaultCurrency={defaultCcy}
          onChange={(v) => props.onChange(v)}
          error={error}
        />
      );
    }

    case "duration":
      // Duration accepts either seconds ("90") or "HH:MM:SS" / "MM:SS".
      // TextInput preserves the shorthand; NumberInput would force
      // the user to compute seconds.
      return (
        <TextInput
          label={label}
          description={helpText}
          required={required}
          placeholder="HH:MM:SS or seconds"
          value={stringValue}
          onInput={(v) => props.onChange(v)}
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
      const includeTime =
        (props.field.config as { includeTime?: boolean }).includeTime ?? false;
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
          error={error}
        />
      );
    }

    case "multi-select": {
      // Stacked Checkboxes — one row per option. The platform Checkbox
      // is the only multi-pick primitive that CONSTRAINS input to the
      // declared options. (TagsInput is freeform, SelectInput is
      // single-pick, SelectChip is single-pick chip.) A wrapped group
      // keeps everything inside the platform's input vocabulary AND
      // prevents users from typing non-existent option ids.
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
          <Show when={error()}>
            <p class="text-[11px] text-red-500">{error()}</p>
          </Show>
        </div>
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
            <p class="text-xs text-amber-600 dark:text-amber-400">
              Relation has no target table configured — skipping.
            </p>
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
            labels={() => ({})}
            onChange={(v) => props.onChange(v)}
          />
          <Show when={error()}>
            <p class="text-[11px] text-red-500">{error()}</p>
          </Show>
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
          error={error}
        />
      );
  }
}
