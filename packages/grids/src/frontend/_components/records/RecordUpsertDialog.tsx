import { DialogHeader, dialogCore } from "@valentinkolb/cloud/ui";
import { createSignal, For } from "solid-js";
import type { Field, GridRecord } from "../../service";
import { isUserEditable } from "./field-prompt-schema";
import { FieldInput, type UserInputEntry } from "./form-fields";

/**
 * Shared create/edit dialog for grids records.
 *
 * Why a custom dialog (not `prompts.form` from cloud-ui): the platform-
 * wide form has a fixed set of field types and no relation extension
 * slot. We need one record-write surface where every editable grids
 * field type, including relations, renders inline. The dialog plumbing
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
  ["autonumber", "formula", "lookup", "rollup", "created_at", "created_by", "updated_at", "updated_by"].includes(type);

type OpenArgs = {
  mode: "create" | "edit";
  /** Live fields of the table (deletedAt-filtered upstream). */
  fields: Field[];
  /** Needed by RelationPicker to deep-link out of chips. */
  baseId: string;
  /** Human table name for dialog context. */
  tableName?: string;
  /** Existing record when mode = edit. */
  record?: GridRecord;
  /** Existing relation labels so relation chips do not render as UUIDs. */
  relationLabels?: Record<string, string>;
};

/**
 * Opens the record upsert dialog. Resolves with the field-keyed row
 * payload for POST/PATCH, or `null` if the user dismisses.
 */
export const openRecordUpsertDialog = (args: OpenArgs): Promise<Record<string, unknown> | null> => {
  return dialogCore
    .open<Record<string, unknown> | null>(
      (close) => {
        // Each editable field gets its own signal. Storing them in an
        // object keyed by field id keeps the gather-on-submit step
        // trivial: just walk the fields array and read the signal.
        const editableFields = args.fields.filter(
          (f) => !f.deletedAt && (f.type === "relation" || isUserEditable(f.type)) && !isComputedOrSystem(f.type),
        );

        // values: per-field, lazily initialised. Use a single signal on a
        // record so any update triggers all dependents (cheap — small
        // form). Edit mode starts from the record data; create mode starts
        // from field defaults.
        const initial: Record<string, unknown> = {};
        for (const f of editableFields) {
          if (args.mode === "edit" && args.record) {
            const current = args.record.data[f.id];
            if ((f.type === "relation" || f.type === "select") && !Array.isArray(current)) {
              initial[f.id] = typeof current === "string" && current.length > 0 ? [current] : [];
            } else if (current !== undefined && current !== null) {
              initial[f.id] = current;
            } else {
              initial[f.id] = f.type === "relation" || f.type === "select" ? [] : "";
            }
            continue;
          }
          if (f.type === "relation" || f.type === "select") initial[f.id] = [];
          else if (f.type === "boolean") initial[f.id] = false;
          else if (
            f.type === "date" &&
            typeof f.defaultValue === "object" &&
            f.defaultValue !== null &&
            (f.defaultValue as { kind?: unknown }).kind === "now"
          )
            initial[f.id] = "";
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
        // — full type validation (regex, min/max, decimal parsing) is
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
          // Create omits empties so server-side defaults/nulls apply.
          // Edit sends explicit nulls so users can clear a field. The
          // server validates and normalises every value again.
          const out: Record<string, unknown> = {};
          for (const f of editableFields) {
            const v = values()[f.id];
            const empty = v === "" || v === undefined || v === null || (Array.isArray(v) && v.length === 0);
            if (args.mode === "create" && empty) continue;
            out[f.id] = empty ? null : v;
          }
          close(out);
        };

        // Field renderer. Synthesizes a UserInputEntry from the field
        // (label/required from the field itself, no per-form override)
        // and hands it to FieldInput — the platform's single field
        // renderer. Everything that diverged here (decimal widget,
        // select widget, relation widget) now matches what
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
              relationLabels={args.relationLabels}
            />
          );
        };
        const tableName = args.tableName?.trim();
        const title =
          args.mode === "create"
            ? tableName
              ? `New record · ${tableName}`
              : "New record"
            : tableName
              ? `Edit record · ${tableName}`
              : "Edit record";
        const icon = args.mode === "create" ? "ti ti-row-insert-bottom" : "ti ti-pencil";

        return (
          <form onSubmit={handleSubmit} class="flex flex-col gap-4">
            <DialogHeader title={title} icon={icon} close={() => close(null)} />
            <div class="flex flex-col gap-4">
              <For each={editableFields}>{(f) => renderField(f)}</For>
            </div>
            <div class="flex justify-end gap-3">
              <button type="button" onClick={() => close(null)} class="btn-secondary btn-sm">
                ESC
              </button>
              <button type="submit" class="btn-primary btn-sm">
                {args.mode === "create" ? "Create" : "Save"}
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
    )
    .then((v) => v ?? null);
};
