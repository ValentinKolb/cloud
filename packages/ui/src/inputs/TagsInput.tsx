import { createSignal, For, type JSX } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";

export type TagsInputProps = {
  values?: readonly string[];
  onValuesChange?: (values: string[]) => void;
  normalize?: (value: string) => string;
  validate?: (value: string) => boolean;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  placeholder?: string;
  maxTags?: number;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  class?: string;
  "aria-describedby"?: string;
};

const defaultNormalize = (value: string): string => value.replace(/\s+/g, " ").trim();

export function TagsInput(props: TagsInputProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const [announcement, setAnnouncement] = createSignal("");
  const values = () => props.values ?? [];
  const normalize = (value: string) => (props.normalize ?? defaultNormalize)(value);

  const emit = (next: readonly string[]) => props.onValuesChange?.([...next]);
  const addValues = (rawValues: readonly string[], input?: HTMLInputElement) => {
    const next = [...values()];
    for (const rawValue of rawValues) {
      const value = normalize(rawValue);
      if (!value || next.includes(value) || (props.validate && !props.validate(value))) continue;
      if (props.maxTags !== undefined && next.length >= props.maxTags) break;
      next.push(value);
    }
    const added = next.slice(values().length);
    if (added.length === 0) return;
    emit(next);
    if (input) input.value = "";
    setAnnouncement(`Added ${added.join(", ")}`);
  };
  const remove = (value: string) => {
    emit(values().filter((item) => item !== value));
    setAnnouncement(`Removed ${value}`);
  };

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      meta={meta}
      required={props.required}
    >
      <div class="k2b-tags-input" data-invalid={props.error ? "true" : undefined} data-disabled={props.disabled ? "true" : undefined}>
        <For each={values()}>
          {(value) => (
            <span class="k2b-tag">
              <span>{value}</span>
              <button type="button" aria-label={`Remove ${value}`} disabled={props.disabled} onClick={() => remove(value)}>
                <i class="ti ti-x" aria-hidden="true" />
              </button>
              <ShowHiddenInput name={props.name} value={value} />
            </span>
          )}
        </For>
        <input
          id={meta.controlId}
          placeholder={props.placeholder ?? "Add tag…"}
          disabled={props.disabled}
          required={props.required && values().length === 0}
          aria-invalid={props.error ? "true" : undefined}
          aria-describedby={fieldDescribedBy(meta, props.description, props.error, props["aria-describedby"])}
          onPaste={(event) => {
            const text = event.clipboardData?.getData("text");
            if (!text || !/[,\n]/.test(text)) return;
            event.preventDefault();
            addValues(text.split(/[,\n]/), event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addValues([event.currentTarget.value], event.currentTarget);
            } else if (event.key === "Backspace" && !event.currentTarget.value) {
              const last = values().at(-1);
              if (last) remove(last);
            }
          }}
          onBlur={(event) => addValues([event.currentTarget.value], event.currentTarget)}
        />
      </div>
      <span class="k2b-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </span>
    </Field>
  );
}

function ShowHiddenInput(props: { name?: string; value: string }): JSX.Element {
  return props.name ? <input type="hidden" name={props.name} value={props.value} /> : null;
}
