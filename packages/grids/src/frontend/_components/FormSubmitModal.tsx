import { prompts } from "@valentinkolb/cloud/ui";
import { createSignal, For, Show } from "solid-js";
import type { Field, Form } from "../../service";
import { errorMessage } from "./api-helpers";
import { buildInitialValues, FieldInput, userInputEntriesOf } from "./form-fields";

/**
 * Open a modal that lets an authenticated user fill out a form and
 * submit. Mirrors what `PublicFormSubmit` does for anonymous callers
 * but
 *
 * - posts to `POST /api/grids/forms/:formId/submit` (the authenticated
 *   path that gates on form-write OR table-write — same superset trick
 *   the resolver uses), so the user doesn't need a public token,
 * - renders fields with PLATFORM input components only via the shared
 *   `FieldInput` from `form-fields.tsx`,
 * - shows a success card with "OK" + "Add another" actions instead of
 *   redirecting away — fits the modal context where the user came in
 *   to add a single record and likely wants to add more in a row.
 */
export const openFormModal = (form: Form, fields: Field[]) =>
  prompts.dialog<void>(
    (close) => <FormSubmitBody form={form} fields={fields} close={close} />,
    {
      title: form.config.title ?? form.name,
      icon: "ti ti-forms",
      size: "large",
    },
  );

function FormSubmitBody(props: {
  form: Form;
  fields: Field[];
  close: (result?: void) => void;
}) {
  const fieldsById = new Map(props.fields.map((f) => [f.id, f]));
  const entries = userInputEntriesOf(props.form.config.fields);

  const [values, setValues] = createSignal<Record<string, unknown>>(
    buildInitialValues(entries),
  );
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
        if (v === "" || v === undefined || v === null) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        payload[k] = v;
      }
      const res = await fetch(`/api/grids/forms/${props.form.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(await errorMessage(res, "Submit failed"));
        return;
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddAnother = () => {
    setValues(buildInitialValues(entries));
    setError(null);
    setDone(false);
  };

  return (
    <Show
      when={!done()}
      fallback={
        <SuccessState
          message={props.form.config.successMessage ?? "Saved."}
          onOk={() => props.close()}
          onAddAnother={handleAddAnother}
        />
      }
    >
      <form class="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Show when={props.form.config.description}>
          <p class="text-sm text-dimmed">{props.form.config.description}</p>
        </Show>

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
              />
            );
          }}
        </For>

        <Show when={error()}>
          <div class="info-block-error flex items-start gap-2 text-xs">
            <i class="ti ti-alert-circle mt-0.5 shrink-0" />
            <span>{error()}</span>
          </div>
        </Show>

        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            class="btn-simple btn-sm"
            onClick={() => props.close()}
            disabled={submitting()}
          >
            Cancel
          </button>
          <button type="submit" class="btn-primary btn-sm" disabled={submitting()}>
            <Show when={submitting()} fallback={<i class="ti ti-send" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
            {props.form.config.submitLabel ?? "Submit"}
          </button>
        </div>
      </form>
    </Show>
  );
}

function SuccessState(props: {
  message: string;
  onOk: () => void;
  onAddAnother: () => void;
}) {
  return (
    <div class="flex flex-col items-center gap-4 py-4 text-center">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
        <i class="ti ti-check text-2xl" />
      </div>
      <p class="text-sm text-secondary">{props.message}</p>
      <div class="flex items-center gap-2">
        <button type="button" class="btn-simple btn-sm" onClick={props.onAddAnother}>
          <i class="ti ti-plus" />
          Add another
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={props.onOk}>
          OK
        </button>
      </div>
    </div>
  );
}
