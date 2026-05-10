import { For, createSignal } from "solid-js";
import { DialogHeader, dialogCore } from "@valentinkolb/cloud/ui";
import type { Field } from "../../service";
import { isUserEditable } from "./field-prompt-schema";
import { FieldInput, type UserInputEntry } from "./form-fields";

/**
 * Custom create-record dialog for grids tables.
 *
 * Why a custom dialog (not `prompts.form` from cloud-ui): the platform-
 * wide form has a fixed set of field types and no relation extension
 * slot. We need a single-step create where every grids field type —
 * including relations — renders inline. The dialog plumbing
 * (DialogHeader, validation, submit) lives here; the actual field
 * rendering delegates to {@link FieldInput} so create / form-submit /
 * field-designer-default all show the same widget per type
 * (post-cleanup #7).
 *
 * Required-field check is client-side (block submit + show error per
 * field), but the SERVER also enforces required + per-type validation
 * via field-type handlers — so a malicious / racy client can't sneak
 * through.
 */

/** Fields the dialog skips entirely — server-managed (autonumber,
 *  created_*, updated_*) or computed (formula, lookup, rollup). */
const isComputedOrSystem = (type: string): boolean =>
  ["autonumber", "formula", "lookup", "rollup", "created_at", "created_by", "updated_at", "updated_by"].includes(
    type,
  );

type OpenArgs = {
  /** Live fields of the table (deletedAt-filtered upstream). */
  fields: Field[];
  /** Needed by RelationPicker to deep-link out of chips. */
  baseId: string;
};

/**
 * Opens the create-record dialog. Resolves with the row payload on
 * Create (already field-keyed for `POST /records/by-table/:tableId`),
 * or `null` if the user dismisses.
 */
export const openCreateRecordDialog = (args: OpenArgs): Promise<Record<string, unknown> | null> => {
  return dialogCore.open<Record<string, unknown> | null>(
    (close) => {
      // Each editable field gets its own signal. Storing them in an
      // object keyed by field id keeps the gather-on-submit step
      // trivial: just walk the fields array and read the signal.
      const editableFields = args.fields.filter(
        (f) => !f.deletedAt && (f.type === "relation" || isUserEditable(f.type)) && !isComputedOrSystem(f.type),
      );

      // values: per-field, lazily initialised. Use a single signal on a
      // record so any update triggers all dependents (cheap — small
      // form). Defaults: empty array for relations / multi-select,
      // empty string for text shapes, false for boolean, etc.
      const initial: Record<string, unknown> = {};
      for (const f of editableFields) {
        if (f.type === "relation" || f.type === "multi-select") initial[f.id] = [];
        else if (f.type === "boolean") initial[f.id] = false;
        else if (f.defaultValue !== null && f.defaultValue !== undefined) initial[f.id] = f.defaultValue;
        else initial[f.id] = "";
      }
      const [values, setValues] = createSignal<Record<string, unknown>>(initial);
      const [errors, setErrors] = createSignal<Record<string, string>>({});

      const update = (id: string, v: unknown) => {
        setValues({ ...values(), [id]: v });
        // Clear the error on user touch — let server-side feedback be
        // the authoritative re-check, but don't keep a stale red banner
        // visible while they're typing.
        if (errors()[id]) {
          const next = { ...errors() };
          delete next[id];
          setErrors(next);
        }
      };

      // Pre-flight required check. Mirrors the server's per-field
      // validation closely but only catches the "obvious empty" cases
      // — full type validation (regex, min/max, currency parsing) is
      // left to the server, which surfaces errors via prompts.error.
      const validate = (): boolean => {
        const errs: Record<string, string> = {};
        for (const f of editableFields) {
          if (!f.required) continue;
          const v = values()[f.id];
          if (v === null || v === undefined || v === "") {
            errs[f.id] = "required";
          } else if (Array.isArray(v) && v.length === 0) {
            errs[f.id] = "required";
          }
        }
        setErrors(errs);
        return Object.keys(errs).length === 0;
      };

      const handleSubmit = (e: Event) => {
        e.preventDefault();
        if (!validate()) return;
        // Strip empties so server-side defaults / nulls apply to fields
        // the user left untouched. Same shape as the old sanitizePayload.
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(values())) {
          if (v === "" || v === undefined || v === null) continue;
          if (Array.isArray(v) && v.length === 0) continue;
          out[k] = v;
        }
        close(out);
      };

      // Field renderer. Synthesizes a UserInputEntry from the field
      // (label/required from the field itself, no per-form override)
      // and hands it to FieldInput — the platform's single field
      // renderer. Everything that diverged here (currency widget,
      // multi-select widget, relation widget) now matches what
      // PublicFormSubmit, FormSubmitModal, and the field-designer's
      // default-value editor render for the same type.
      const renderField = (f: Field) => {
        const entry: UserInputEntry = {
          kind: "user_input",
          fieldId: f.id,
          required: f.required,
          helpText: f.description ?? undefined,
        };
        return (
          <FieldInput
            field={f}
            entry={entry}
            value={values()[f.id]}
            onChange={(v) => update(f.id, v)}
            error={() => errors()[f.id]}
            baseId={args.baseId}
          />
        );
      };

      return (
        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          <DialogHeader title="New record" icon="ti ti-row-insert-bottom" close={() => close(null)} />
          <div class="flex flex-col gap-4">
            <For each={editableFields}>{(f) => renderField(f)}</For>
          </div>
          <div class="flex justify-end gap-3">
            <button type="button" onClick={() => close(null)} class="btn-secondary btn-sm">
              ESC
            </button>
            <button type="submit" class="btn-primary btn-sm">
              Create
            </button>
          </div>
        </form>
      );
    },
    {
      // Build the panel class manually instead of leaning on the
      // `dialog-panel` utility — that one caps at max-w-md (28rem) and
      // a semi-transparent backdrop (bg-black/40), which combined makes
      // the form feel cramped + lets the page behind bleed through when
      // the content is long enough to scroll.
      //
      // Pattern matches what platform `prompts.form size="large"` does:
      // 48rem max width, opaque bg with a tiny tint (95%) for depth, a
      // dimmer + blurred backdrop so the page behind reads as muted not
      // visible. Result: solid feel even when the form scrolls.
      panelClassName:
        "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[min(96vw,48rem)] max-h-[86vh] overflow-x-hidden overflow-y-auto rounded-2xl border-0 bg-white/95 p-4 text-zinc-900 shadow-none ring-1 ring-inset ring-zinc-300/60 dark:bg-zinc-950/95 dark:text-zinc-100 dark:ring-zinc-700/60 backdrop:bg-black/45 dark:backdrop:bg-black/35 backdrop:backdrop-blur-sm",
    },
  ).then((v) => v ?? null);
};
