import { createSignal, For, onMount, Show } from "solid-js";
import type { DateContext } from "@valentinkolb/stdlib";
import { apiClient } from "@/api/client";
import type { Field, Form } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import { buildInitialValues, FieldInput, userInputEntriesOf } from "./form-fields";

type Props = {
  /** Public token from the URL — submitted to the public endpoint. */
  publicToken: string;
  /** Form config (fields, labels, defaults) — server-trusted. */
  form: Form;
  /** Resolved table fields so we know each entry's type + options. */
  fields: Field[];
  dateConfig?: DateContext;
};

/**
 * Public-form submit page. Renders one input per form-field-entry via
 * the shared {@link FieldInput} (same component used by the in-app
 * `FormSubmitModal`), posts to the public submit endpoint anonymously,
 * and shows a success message — or redirects when `redirectUrl` is
 * configured.
 *
 * All field rendering lives in `form-fields.tsx` and uses platform
 * inputs only (TextInput / NumberInput / DatePicker / DateTimePicker /
 * Checkbox / SelectInput / CheckboxCards for select).
 */
export default function PublicFormSubmit(props: Props) {
  const fieldsById = new Map(props.fields.map((f) => [f.id, f]));
  const entries = userInputEntriesOf(props.form.config.fields);
  let formRef: HTMLFormElement | undefined;

  const [values, setValues] = createSignal<Record<string, unknown>>(buildInitialValues(entries));
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [done, setDone] = createSignal(false);
  const [clientReady, setClientReady] = createSignal(false);

  const setValue = (fieldId: string, v: unknown) => setValues((current) => ({ ...current, [fieldId]: v }));

  onMount(() => setClientReady(true));

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { ...values() };
      if (formRef) {
        const formData = new FormData(formRef);
        for (const [key, value] of formData.entries()) {
          if (typeof value !== "string") continue;
          payload[key] = value;
        }
      }
      for (const [k, v] of Object.entries(payload)) {
        if (v === "" || v === undefined || v === null) {
          delete payload[k];
          continue;
        }
        if (Array.isArray(v) && v.length === 0) {
          delete payload[k];
          continue;
        }
        payload[k] = v;
      }
      const res = await apiClient.forms.public[":token"].submit.$post({
        param: { token: props.publicToken },
        json: payload,
      });
      if (!res.ok) {
        setError(await errorMessage(res, "Submit failed"));
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
      {/* Optional title image — banner above the form. Compact
          max-h (96 px) + object-contain matches FormSubmitModal so
          the public page and the in-app preview render the same
          shape regardless of source aspect ratio. */}
      <Show when={props.form.config.titleImage}>
        {(src) => <img src={src()} alt="" class="w-full max-h-24 rounded-md object-contain" />}
      </Show>
      <header class="flex flex-col gap-1">
        <h1 class="text-lg font-semibold text-primary">{props.form.config.title ?? props.form.name}</h1>
        <Show when={props.form.config.description}>
          <p class="text-sm text-dimmed">{props.form.config.description}</p>
        </Show>
      </header>

      <Show
        when={!done()}
        fallback={
          <div class="info-block-success flex items-center gap-2 text-sm">
            <i class="ti ti-circle-check shrink-0" />
            <span>{props.form.config.successMessage ?? "Saved"}</span>
          </div>
        }
      >
        <form
          ref={formRef}
          class="flex flex-col gap-3"
          data-grids-public-form-ready={clientReady() ? "true" : "false"}
          onSubmit={handleSubmit}
        >
          <For each={entries}>
            {(entry) => {
              const field = fieldsById.get(entry.fieldId);
              if (!field || field.deletedAt) return null;
              return (
                <FieldInput
                  field={field}
                  entry={entry}
                  value={values()[entry.fieldId]}
                  onChange={(v) => setValue(entry.fieldId, v)}
                  dateConfig={props.dateConfig}
                />
              );
            }}
          </For>

          <Show when={error()}>
            <div class="info-block-error flex items-start gap-2 text-sm">
              <i class="ti ti-alert-circle mt-0.5 shrink-0" />
              <span>{error()}</span>
            </div>
          </Show>

          {/* Wrap the button so it sizes to its content rather than
              stretching the full form width (flex-column children are
              `align-items: stretch` by default). */}
          <div class="mt-2 flex items-center justify-end">
            <button type="submit" class="btn-primary btn-sm" disabled={submitting()}>
              <Show when={submitting()} fallback={<i class="ti ti-send" />}>
                <i class="ti ti-loader-2 animate-spin" />
              </Show>
              {props.form.config.submitLabel ?? "Submit"}
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
