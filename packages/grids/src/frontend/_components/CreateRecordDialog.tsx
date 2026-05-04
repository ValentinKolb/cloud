import { For, Show, createSignal } from "solid-js";
import {
  CheckboxInput,
  DateTimeInput,
  DialogHeader,
  NumberInput,
  SelectInput,
  TagsInput,
  TextInput,
  dialogCore,
} from "@valentinkolb/cloud/ui";
import type { Field } from "../../service";
import { isUserEditable } from "./field-prompt-schema";
import RelationPicker from "./RelationPicker";

/**
 * Custom create-record dialog for grids tables.
 *
 * Why we don't reuse `prompts.form` from cloud-ui: that platform-wide
 * form has a fixed set of field types (text, number, select, tags,
 * boolean, datetime, info) and no extension slot. We need to render
 * relation fields with an inline `RelationPicker` so the user can pick
 * linked records in the SAME dialog as the rest of the row — Airtable-
 * style single-step create. So this file owns its own dialog.
 *
 * The renderer mirrors `prompts.form`'s look (DialogHeader, gap-4
 * flex-col, btn-primary footer) so it doesn't visually diverge from
 * the rest of the platform's dialogs. The only thing that differs is
 * the field-type coverage — relations are a first-class citizen here.
 *
 * Required-field check is client-side (block submit + show error per
 * field), but the SERVER also enforces required relations via the
 * relation field-type handler — so a malicious / racy client can't
 * sneak through.
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

      // Field renderer. One switch handles every editable type — the
      // map is small enough that a switch reads better than a registry.
      const renderField = (f: Field) => {
        const error = () => errors()[f.id];
        const label = f.name + (f.required ? " *" : "");
        const description = f.description ?? undefined;

        switch (f.type) {
          case "text":
          case "email":
          case "url":
          case "phone":
          case "slug":
          case "barcode":
          case "isbn":
          case "currency":
          case "duration":
            return (
              <TextInput
                label={label}
                description={description}
                placeholder={
                  f.type === "currency"
                    ? "12.34 EUR"
                    : f.type === "email"
                      ? "name@example.com"
                      : f.type === "url"
                        ? "https://…"
                        : f.type === "duration"
                          ? "HH:MM:SS or seconds"
                          : undefined
                }
                value={() => String(values()[f.id] ?? "")}
                onInput={(v) => update(f.id, v)}
                error={error}
              />
            );
          case "longtext":
          case "json":
            return (
              <TextInput
                label={label}
                description={description}
                multiline
                lines={f.type === "json" ? 6 : 4}
                value={() => String(values()[f.id] ?? "")}
                onInput={(v) => update(f.id, v)}
                error={error}
              />
            );
          case "number":
          case "decimal":
            return (
              <NumberInput
                label={label}
                description={description}
                value={() => Number(values()[f.id] ?? 0)}
                onChange={(v) => update(f.id, v)}
                error={error}
              />
            );
          case "rating": {
            const scale = (f.config as { scale?: number }).scale ?? 5;
            return (
              <NumberInput
                label={label}
                description={description}
                min={0}
                max={scale}
                value={() => Number(values()[f.id] ?? 0)}
                onChange={(v) => update(f.id, v)}
                error={error}
              />
            );
          }
          case "percent":
            return (
              <NumberInput
                label={label}
                description={description}
                min={0}
                max={100}
                value={() => Number(values()[f.id] ?? 0)}
                onChange={(v) => update(f.id, v)}
                error={error}
              />
            );
          case "boolean":
            return (
              <CheckboxInput
                label={label}
                description={description}
                value={() => Boolean(values()[f.id])}
                onChange={(v) => update(f.id, v)}
                error={error}
              />
            );
          case "date": {
            const includeTime = (f.config as { includeTime?: boolean }).includeTime ?? false;
            return (
              <DateTimeInput
                label={label}
                description={description}
                dateOnly={!includeTime}
                value={() => String(values()[f.id] ?? "")}
                onChange={(v) => update(f.id, v)}
                error={error}
              />
            );
          }
          case "single-select": {
            const options = ((f.config as { options?: Array<{ id: string; label: string }> }).options ?? []).map((o) => ({
              id: o.id,
              label: o.label,
            }));
            return (
              <SelectInput
                label={label}
                description={description}
                options={options}
                clearable={!f.required}
                value={() => String(values()[f.id] ?? "")}
                onChange={(v) => update(f.id, v)}
                error={error}
              />
            );
          }
          case "multi-select":
            return (
              <TagsInput
                label={label}
                description={description}
                value={() => (values()[f.id] as string[]) ?? []}
                onChange={(v) => update(f.id, v)}
                error={error}
              />
            );
          case "relation": {
            const cfg = f.config as { targetTableId?: string; cardinality?: "single" | "multiple" };
            if (!cfg.targetTableId) {
              // Misconfigured relation — show a placeholder rather than
              // crash. The user can still create the row without it.
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
                <span class="text-xs font-medium text-secondary">{label}</span>
                <Show when={description}>
                  <p class="text-[11px] text-dimmed leading-snug">{description}</p>
                </Show>
                <RelationPicker
                  targetTableId={cfg.targetTableId}
                  multi={multi}
                  value={() => (values()[f.id] as string[]) ?? []}
                  labels={() => ({})}
                  onChange={(v) => update(f.id, v)}
                />
                <Show when={error()}>
                  <p class="text-[11px] text-red-500">{error()}</p>
                </Show>
              </div>
            );
          }
          default:
            // Unhandled type (shouldn't reach — filter excludes computed
            // types and isUserEditable gates the rest). Render a tiny
            // hint so a misconfig doesn't silently swallow data.
            return (
              <div class="text-xs text-dimmed">
                <span class="font-medium">{label}</span>: type "{f.type}" not supported in create form
              </div>
            );
        }
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
