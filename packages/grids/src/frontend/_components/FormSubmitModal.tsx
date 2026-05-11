import { CopyButton, prompts } from "@valentinkolb/cloud/ui";
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
        {/* Optional title image — banner above the description.
            `w-full` lets a wide source span the form; `max-h-24` (6 rem
            ≈ 96 px) caps the height so a square or portrait source
            stays a compact banner instead of dominating the form;
            `object-contain` preserves the source aspect ratio (no
            cropping) so a small logo doesn't get squished into the
            full width. Pre-fix used `max-h-48 object-cover` which
            stretched a square logo to ~192 px tall and covered most
            of the modal. */}
        <Show when={props.form.config.titleImage}>
          {(src) => (
            <img
              src={src()}
              alt=""
              class="w-full max-h-24 rounded-md object-contain"
            />
          )}
        </Show>
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

        <div class="mt-2 flex items-center gap-2">
          {/* Public-form share affordance — bottom-left so it doesn't
              compete with the primary Submit on the right. Only shown
              when the form is publicly shared (has a token); for
              private forms the button is meaningless. The full
              absolute URL is built at click time from `window.location.origin`
              so the copied link points at the correct host (SSR can't
              resolve this — the modal is hydrated client-side anyway). */}
          <Show when={props.form.publicToken}>
            {(token) => (
              <CopyButton
                text={`${typeof window !== "undefined" ? window.location.origin : ""}/share/grids/forms/${token()}`}
                label="Copy public link"
                class="btn-simple btn-sm"
              />
            )}
          </Show>
          <div class="ml-auto flex items-center gap-2">
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
