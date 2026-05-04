import { For, Show, createSignal } from "solid-js";
import type { Field, Form, FormFieldEntry } from "../../service";
import { errorMessage } from "./api-helpers";

type Props = {
  /** Public token from the URL — submitted to the public endpoint. */
  publicToken: string;
  /** Form config (fields, labels, defaults) — server-trusted. */
  form: Form;
  /** Resolved table fields so we know each entry's type + options. */
  fields: Field[];
};

const inputClass =
  "w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30";

/**
 * Public-form submit page. Renders one input per form-field-entry, posts
 * to the public submit endpoint anonymously, and shows a success message
 * (or redirects when redirectUrl is configured).
 */
export default function PublicFormSubmit(props: Props) {
  const fieldsById = new Map(props.fields.map((f) => [f.id, f]));
  // v3 Slice 6: filter to user_input entries only. form_value entries
  // are server-applied — they don't render in the UI and the user can't
  // override their value (the API rejects payload keys for them).
  const userInputEntries = () =>
    props.form.config.fields.filter(
      (e): e is Extract<FormFieldEntry, { kind: "user_input" }> => e.kind === "user_input",
    );
  const initialValues: Record<string, unknown> = {};
  for (const entry of userInputEntries()) {
    if (entry.defaultValue !== undefined && entry.defaultValue !== null) {
      initialValues[entry.fieldId] = entry.defaultValue;
    }
  }
  const [values, setValues] = createSignal<Record<string, unknown>>(initialValues);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [done, setDone] = createSignal(false);

  const setValue = (fieldId: string, v: unknown) => setValues({ ...values(), [fieldId]: v });

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values())) {
        if (v === "" || v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        payload[k] = v;
      }
      const res = await fetch(`/api/grids/forms/public/${props.publicToken}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(await errorMessage(res, "Submit failed"));
        setSubmitting(false);
        return;
      }
      const redirect = props.form.config.redirectUrl;
      if (redirect) {
        window.location.href = redirect;
        return;
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="paper p-6 max-w-xl mx-auto flex flex-col gap-4">
      <header class="flex flex-col gap-1">
        <h1 class="text-lg font-semibold text-primary">{props.form.config.title ?? props.form.name}</h1>
        <Show when={props.form.config.description}>
          <p class="text-sm text-dimmed">{props.form.config.description}</p>
        </Show>
      </header>

      <Show
        when={!done()}
        fallback={
          <div class="rounded-md bg-emerald-50 dark:bg-emerald-900/30 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            <i class="ti ti-circle-check" /> {props.form.config.successMessage ?? "Saved"}
          </div>
        }
      >
        <form class="flex flex-col gap-3" onSubmit={handleSubmit}>
          <For each={userInputEntries()}>
            {(entry) => {
              const field = fieldsById.get(entry.fieldId);
              if (!field || field.deletedAt) return null;
              return (
                <FieldInput
                  field={field}
                  entry={entry}
                  value={values()[entry.fieldId]}
                  onChange={(v) => setValue(entry.fieldId, v)}
                />
              );
            }}
          </For>

          <Show when={error()}>
            <div class="rounded-md bg-red-50 dark:bg-red-900/30 p-3 text-sm text-red-600 dark:text-red-300">
              <i class="ti ti-alert-circle" /> {error()}
            </div>
          </Show>

          <button
            type="submit"
            class="btn-primary mt-2"
            disabled={submitting()}
          >
            <Show when={submitting()} fallback={<i class="ti ti-send" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
            {props.form.config.submitLabel ?? "Submit"}
          </button>
        </form>
      </Show>
    </div>
  );
}

function FieldInput(props: {
  field: Field;
  /** Always a user_input entry — form_value entries don't render. */
  entry: Extract<FormFieldEntry, { kind: "user_input" }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = props.entry.label || props.field.name;
  const required = props.entry.required ?? props.field.required;

  const labelEl = (
    <span class="flex items-baseline gap-1 text-xs font-medium text-secondary">
      {label}
      <Show when={required}>
        <span class="text-red-500" aria-hidden="true">
          *
        </span>
      </Show>
    </span>
  );
  const helpEl = props.entry.helpText ? (
    <span class="text-[11px] text-dimmed">{props.entry.helpText}</span>
  ) : null;
  const wrap = (input: any) => (
    <label class="flex flex-col gap-1">
      {labelEl}
      {input}
      {helpEl}
    </label>
  );

  switch (props.field.type) {
    case "longtext":
      return wrap(
        <textarea
          class={inputClass}
          rows={4}
          required={required}
          value={typeof props.value === "string" ? props.value : ""}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />,
      );
    case "number":
    case "decimal":
    case "rating":
      return wrap(
        <input
          type="number"
          class={inputClass}
          required={required}
          value={typeof props.value === "number" || typeof props.value === "string" ? String(props.value) : ""}
          onInput={(e) => {
            const n = e.currentTarget.valueAsNumber;
            props.onChange(Number.isFinite(n) ? n : "");
          }}
        />,
      );
    case "boolean":
      return wrap(
        <label class="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.value === true}
            onChange={(e) => props.onChange(e.currentTarget.checked)}
          />
          <span class="text-sm">{props.value === true ? "Yes" : "No"}</span>
        </label>,
      );
    case "date":
      return wrap(
        <input
          type="date"
          class={inputClass}
          required={required}
          value={typeof props.value === "string" ? props.value : ""}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />,
      );
    case "single-select": {
      const options = ((props.field.config as { options?: Array<{ id: string; label: string }> }).options ?? []);
      return wrap(
        <select
          class={inputClass}
          required={required}
          value={typeof props.value === "string" ? props.value : ""}
          onChange={(e) => props.onChange(e.currentTarget.value || null)}
        >
          <option value="">—</option>
          <For each={options}>{(o) => <option value={o.id}>{o.label}</option>}</For>
        </select>,
      );
    }
    case "multi-select": {
      const options = ((props.field.config as { options?: Array<{ id: string; label: string }> }).options ?? []);
      // Derive the current selection inside reactive expressions so each
      // click sees the latest state (the previous closure capture meant
      // every click used the initial array, breaking add/remove on the
      // second tag tap).
      const selected = (): string[] => (Array.isArray(props.value) ? (props.value as string[]) : []);
      return wrap(
        <div class="flex flex-wrap gap-1.5">
          <For each={options}>
            {(o) => (
              <button
                type="button"
                class={`rounded-md px-2 py-1 text-xs ${
                  selected().includes(o.id)
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
                onClick={() => {
                  const current = selected();
                  const next = current.includes(o.id)
                    ? current.filter((s) => s !== o.id)
                    : [...current, o.id];
                  props.onChange(next);
                }}
              >
                {o.label}
              </button>
            )}
          </For>
        </div>,
      );
    }
    default:
      return wrap(
        <input
          type="text"
          class={inputClass}
          required={required}
          value={typeof props.value === "string" ? props.value : ""}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />,
      );
  }
}
