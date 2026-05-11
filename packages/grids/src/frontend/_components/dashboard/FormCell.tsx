import { createSignal, For, Show } from "solid-js";
import type { FormWidget } from "../../../service";
import { errorMessage } from "../api-helpers";
import {
  buildInitialValues,
  FieldInput,
  userInputEntriesOf,
} from "../form-fields";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: FormWidget;
  data: WidgetData;
};

/**
 * Form cell — embeds a form for inline data entry on the dashboard.
 * Mirrors `FormSubmitModal` (the in-app form view) but renders inline
 * in a cell slot instead of a modal, and on successful submit it
 * triggers a full page reload (`window.location.reload()`) so every
 * other widget on the dashboard re-resolves with the freshly written
 * record.
 *
 * Full reload is the v1 trade: dead simple, guarantees visible
 * consistency across stat / chart / view cells without per-widget
 * invalidation logic. Scroll position is lost — acceptable for a
 * dashboard's "punch in some data" surface.
 *
 * No-permission handling: filed as follow-up. v1 always renders the
 * form; if the viewer lacks form-write or table-write, the submit
 * request fails server-side and the error surfaces in the form's
 * error region.
 */
export default function FormCell(props: Props) {
  const isForm = (d: WidgetData): d is Extract<WidgetData, { kind: "form" }> =>
    d.kind === "form";

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <Show
        when={isForm(props.data)}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed px-3 py-2 text-center">
            <Show when={props.data.kind === "error"} fallback="Loading…">
              <span class="text-red-600 dark:text-red-400">
                {(props.data as { kind: "error"; reason: string }).reason}
              </span>
            </Show>
          </div>
        }
      >
        {(() => {
          const d = props.data as Extract<WidgetData, { kind: "form" }>;
          return (
            <FormBody widget={props.widget} form={d.form} fields={d.fields} />
          );
        })()}
      </Show>
    </div>
  );
}

/** Inline form-submit body. Pulled out of FormCell so the Show
 *  fallback can narrow `props.data.kind === "form"` cleanly and the
 *  body itself manages its own signals/state. */
function FormBody(props: {
  widget: FormWidget;
  form: Extract<WidgetData, { kind: "form" }>["form"];
  fields: Extract<WidgetData, { kind: "form" }>["fields"];
}) {
  const fieldsById = new Map(props.fields.map((f) => [f.id, f]));
  const entries = userInputEntriesOf(props.form.config.fields);

  const [values, setValues] = createSignal<Record<string, unknown>>(
    buildInitialValues(entries),
  );
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const setValue = (fieldId: string, v: unknown) =>
    setValues({ ...values(), [fieldId]: v });

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
      // Full page reload — every other widget on the dashboard
      // re-resolves with the new row visible. KISS approach to
      // post-submit consistency; in-cell success state would leave
      // sibling widgets stale.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const titleOf = () =>
    props.widget.title ?? props.form.config.title ?? props.form.name;

  return (
    <>
      <header class="px-3 py-2">
        <span class="text-xs font-semibold text-primary truncate">{titleOf()}</span>
      </header>
      <form
        class="flex-1 min-h-0 overflow-auto px-3 pb-3 flex flex-col gap-3"
        onSubmit={handleSubmit}
      >
        <Show when={props.form.config.description}>
          <p class="text-xs text-dimmed">{props.form.config.description}</p>
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

        <div class="mt-auto pt-2 flex justify-end">
          <button type="submit" class="btn-primary btn-sm" disabled={submitting()}>
            <Show when={submitting()} fallback={<i class="ti ti-send" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
            {props.form.config.submitLabel ?? "Submit"}
          </button>
        </div>
      </form>
    </>
  );
}
