import type { DateContext } from "@valentinkolb/stdlib";
import { createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, FormWidget } from "../../../service";
import { buildFormSubmitPayload, buildInitialValues, FieldInput, type InlineCreateState, userInputEntriesOf } from "../forms/form-fields";
import { errorMessage } from "../utils/api-helpers";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: FormWidget;
  data: WidgetData;
  onSubmitted?: () => void;
  dateConfig?: DateContext;
};

/**
 * Form cell — embeds a form for inline data entry on the dashboard.
 * Mirrors `FormSubmitModal` (the in-app form view) but renders inline
 * in a cell slot instead of a modal, and on successful submit it
 * notifies the parent so every other widget on the dashboard re-resolves
 * with the freshly written record. The submit endpoint remains the single
 * backend write path; the dashboard only invalidates its server-resolved
 * widget data.
 *
 * **Permission gating.** `data.canSubmit` is resolved SSR-side by
 * the widget resolver — it carries the result of the same form-write
 * OR table-write gate the submit API enforces. When false, the cell
 * renders a tonal "no access" placeholder instead of the form, so
 * users without submit perms see a stable layout and not a control
 * they'd just bounce off of. Zero extra client-side perm fetches.
 */
export default function FormCell(props: Props) {
  const isForm = (d: WidgetData): d is Extract<WidgetData, { kind: "form" }> => d.kind === "form";

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <Show
        when={isForm(props.data)}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed px-3 py-2 text-center">
            <Show when={props.data.kind === "error"} fallback="Loading…">
              <span class="text-red-600 dark:text-red-400">{(props.data as { kind: "error"; reason: string }).reason}</span>
            </Show>
          </div>
        }
      >
        {(() => {
          const d = props.data as Extract<WidgetData, { kind: "form" }>;
          if (!d.canSubmit) {
            return <NoAccessPlaceholder widget={props.widget} formName={d.form.name} />;
          }
          return (
            <FormBody widget={props.widget} form={d.form} fields={d.fields} onSubmitted={props.onSubmitted} dateConfig={props.dateConfig} />
          );
        })()}
      </Show>
    </div>
  );
}

/** Dimmed "no access" placeholder rendered when the viewer can't
 *  submit this form. Keeps the cell's slot occupied so the dashboard
 *  layout stays stable across users with different permission sets —
 *  the alternative (collapse the cell) would make screenshots and
 *  permalinks behave differently for different viewers. */
function NoAccessPlaceholder(props: { widget: FormWidget; formName: string }) {
  const titleOf = () => props.widget.title ?? props.formName;
  return (
    <>
      <header class="px-3 py-2 flex items-center gap-2">
        <i class="ti ti-lock text-sm text-dimmed shrink-0" />
        <span class="text-xs font-semibold text-dimmed truncate">{titleOf()}</span>
      </header>
      <div class="flex-1 flex flex-col items-center justify-center text-center px-4 py-6 gap-1">
        <i class="ti ti-shield-lock text-2xl text-dimmed" />
        <p class="text-xs text-dimmed">You don't have permission to submit this form.</p>
      </div>
    </>
  );
}

/** Inline form-submit body. Pulled out of FormCell so the Show
 *  fallback can narrow `props.data.kind === "form"` cleanly and the
 *  body itself manages its own signals/state. */
function FormBody(props: {
  widget: FormWidget;
  form: Extract<WidgetData, { kind: "form" }>["form"];
  fields: Extract<WidgetData, { kind: "form" }>["fields"];
  onSubmitted?: () => void;
  dateConfig?: DateContext;
}) {
  const fieldsById = new Map(props.fields.map((f) => [f.id, f]));
  const entries = userInputEntriesOf(props.form.config.fields);

  const [values, setValues] = createSignal<Record<string, unknown>>(buildInitialValues(entries));
  const [inlineCreates, setInlineCreates] = createSignal<InlineCreateState>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [clientReady, setClientReady] = createSignal(false);

  onMount(() => setClientReady(true));

  const setValue = (fieldId: string, v: unknown) => setValues((current) => ({ ...current, [fieldId]: v }));
  const setInlineDrafts = (fieldId: string, drafts: InlineCreateState[string]) =>
    setInlineCreates((current) => ({ ...current, [fieldId]: drafts }));

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = buildFormSubmitPayload(
        entries.map((entry) => fieldsById.get(entry.fieldId)).filter((field): field is Field => Boolean(field && !field.deletedAt)),
        values(),
        inlineCreates(),
        { omitEmpty: true },
      );
      const res = await apiClient.forms[":formId"].submit.$post({
        param: { formId: props.form.id },
        json: payload,
      });
      if (!res.ok) {
        setError(await errorMessage(res, "Submit failed"));
        return;
      }
      setValues(buildInitialValues(entries));
      setInlineCreates({});
      props.onSubmitted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const titleOf = () => props.widget.title ?? props.form.config.title ?? props.form.name;

  return (
    <>
      <header class="shrink-0 px-3 py-2">
        <span class="text-xs font-semibold text-primary truncate">{titleOf()}</span>
      </header>
      <form class="flex min-h-0 flex-1 flex-col" data-grids-dashboard-form-ready={clientReady()} onSubmit={handleSubmit}>
        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3">
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
                  inlineCreates={inlineCreates}
                  onInlineCreatesChange={setInlineDrafts}
                  dateConfig={props.dateConfig}
                />
              );
            }}
          </For>
        </div>

        <div class="shrink-0 border-t border-zinc-100 bg-white/95 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/95">
          <Show when={error()}>
            <div class="info-block-error mb-2 flex items-start gap-2 text-xs">
              <i class="ti ti-alert-circle mt-0.5 shrink-0" />
              <span>{error()}</span>
            </div>
          </Show>
          <div class="flex justify-end">
            <button type="submit" class="btn-primary btn-sm" disabled={submitting()}>
              <Show when={submitting()} fallback={<i class="ti ti-send" />}>
                <i class="ti ti-loader-2 animate-spin" />
              </Show>
              {props.form.config.submitLabel ?? "Submit"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
