import { AutocompleteEditor, DataTable, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { Field } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import { buildFormulaCompletions, formulaFieldRefs, formulaFieldToken, formulaHighlight } from "./formula-authoring";

type FormulaPreviewResponse = {
  ok: boolean;
  diagnostics: { severity: "error" | "info"; message: string }[];
  fields: { id: string; shortId: string; name: string; type: string }[];
  rows: { recordId: string; values: Record<string, unknown>; result: unknown }[];
};

const previewValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(previewValue).join(", ");
  return JSON.stringify(value);
};

const formulaReferenceHref = (args: { baseShortId?: string; tableShortId?: string; currentFieldId?: string }) => {
  if (!args.baseShortId || !args.tableShortId) return null;
  const params = args.currentFieldId ? `?field=${encodeURIComponent(args.currentFieldId)}` : "";
  return `/app/grids/${encodeURIComponent(args.baseShortId)}/table/${encodeURIComponent(args.tableShortId)}/formula-reference${params}`;
};

const openReferenceWindow = (href: string | null) => {
  if (!href || typeof window === "undefined") return;
  window.open(href, "grids-formula-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
};

function FormulaPreview(props: { preview: FormulaPreviewResponse | null; loading: boolean }) {
  const columns = (): DataTableColumn<FormulaPreviewResponse["rows"][number]>[] => {
    const preview = props.preview;
    if (!preview) return [];
    return [
      ...preview.fields.map((field) => ({
        id: field.id,
        header: field.name,
        subtitle: field.type,
        value: (row: FormulaPreviewResponse["rows"][number]) => row.values[field.id],
      })),
      {
        id: "result",
        header: "Result",
        value: (row: FormulaPreviewResponse["rows"][number]) => row.result,
        headerClass: "text-primary",
      },
    ];
  };

  return (
    <div class="flex flex-col gap-2 text-xs">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium text-secondary">Formula preview</span>
        <Show when={props.loading}>
          <span class="inline-flex items-center gap-1 text-[11px] text-dimmed">
            <i class="ti ti-loader-2 animate-spin" /> Checking
          </span>
        </Show>
      </div>

      <div class="h-48 overflow-auto">
        <Show when={props.preview} fallback={<p class="text-dimmed">Type a formula to preview the latest records.</p>}>
          {(preview) => (
            <div class="flex flex-col gap-2">
              <Show when={preview().diagnostics.length > 0}>
                <div class={preview().ok ? "info-block-info py-1.5 text-[11px]" : "info-block-danger py-1.5 text-[11px]"}>
                  <For each={preview().diagnostics}>{(diagnostic) => <div>{diagnostic.message}</div>}</For>
                </div>
              </Show>

              <Show
                when={preview().rows.length > 0}
                fallback={<Show when={preview().ok}>{<p class="text-dimmed">No records to preview yet.</p>}</Show>}
              >
                <DataTable
                  rows={preview().rows}
                  columns={columns()}
                  getRowId={(row) => row.recordId}
                  class="overflow-auto"
                  tableClass="w-full text-[11px]"
                  density="compact"
                  stickyHeader={false}
                  hoverRows={false}
                  cellContentClass="max-w-40 whitespace-nowrap"
                  renderCell={({ col, value }) => (
                    <span
                      class={
                        col.id === "result" && typeof value === "string" && value.startsWith("#")
                          ? "font-medium text-red-600 dark:text-red-400"
                          : col.id === "result"
                            ? "font-medium text-secondary"
                            : "text-dimmed"
                      }
                    >
                      {previewValue(value)}
                    </span>
                  )}
                />
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

export function FormulaExpressionEditor(props: {
  value: () => string;
  onInput: (value: string) => void;
  fields: Field[];
  currentTableId: string;
  currentFieldId?: string;
  baseShortId?: string;
  tableShortId?: string;
  ariaLabel?: string;
}) {
  const refs = () => formulaFieldRefs(props.fields, props.currentFieldId);
  const completions = () => buildFormulaCompletions(refs());
  const referenceHref = () =>
    formulaReferenceHref({
      baseShortId: props.baseShortId,
      tableShortId: props.tableShortId,
      currentFieldId: props.currentFieldId,
    });

  const numericRefs = () => refs().filter((field) => ["number", "percent", "duration", "rollup", "formula"].includes(field.type));
  const textRefs = () => refs().filter((field) => ["text", "longtext", "select", "id", "lookup", "formula"].includes(field.type));
  const dateRefs = () => refs().filter((field) => ["date", "created_at", "updated_at", "formula"].includes(field.type));
  const boolRefs = () => refs().filter((field) => ["boolean", "formula"].includes(field.type));
  const refOr = (list: ReturnType<typeof refs>, fallback: string) => (list[0] ? formulaFieldToken(list[0]) : fallback);
  const examples = () => {
    const price = refOr(numericRefs(), "price");
    const qty = refOr(numericRefs().slice(1), "quantity");
    const name = refOr(textRefs(), "name");
    const date = refOr(dateRefs(), "date");
    const active = refOr(boolRefs(), "active");
    return [
      { label: "Markup", expression: `${price} * 1.19` },
      { label: "Total", expression: `${price} * ${qty}` },
      { label: "Text label", expression: `CONCAT(UPPER(${name}), ' - EUR ', ${price})` },
      { label: "Conditional", expression: `IF(${active}, 'Available', 'Out of stock')` },
      { label: "Date age", expression: `DATEDIFF(${date}, TODAY(), 'days')` },
    ];
  };

  const [preview, setPreview] = createSignal<FormulaPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  let previewToken = 0;
  const loadPreview = async (expression: string) => {
    const token = ++previewToken;
    if (!expression.trim()) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await apiClient.formulas["by-table"][":tableId"].check.$post({
        param: { tableId: props.currentTableId },
        json: { expression, currentFieldId: props.currentFieldId ?? null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not preview formula."));
      const data = await res.json();
      if (token === previewToken) setPreview(data);
    } catch (error) {
      if (token === previewToken) {
        setPreview({
          ok: false,
          diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : "Could not preview formula." }],
          fields: [],
          rows: [],
        });
      }
    } finally {
      if (token === previewToken) setPreviewLoading(false);
    }
  };
  const previewDebounce = timed.debounce(loadPreview, 300);
  createEffect(() => {
    previewDebounce.debouncedFn(props.value());
  });

  return (
    <div class="flex flex-col gap-3">
      <div class="info-block-info text-xs flex flex-col gap-2">
        <span class="font-medium">Formula basics</span>
        <span class="text-dimmed">
          Search fields by name, then insert a readable reference. Use double quotes for names with spaces, for example{" "}
          <code>"Unit price"</code>.
        </span>
        <span class="text-dimmed">
          Field renames update saved formulas best effort. Check formulas after renaming important columns.
        </span>
        <span class="text-dimmed">Strings use single quotes. Decimal arithmetic stays exact when exact values are involved.</span>
      </div>

      <div class="info-block-info text-xs flex flex-col gap-2">
        <span class="font-medium">Examples</span>
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <For each={examples()}>
            {(example) => (
              <button
                type="button"
                class="rounded border border-blue-200/70 bg-white/60 px-2 py-1.5 text-left transition hover:border-blue-300 hover:bg-white dark:border-blue-900/60 dark:bg-zinc-950/30 dark:hover:border-blue-800"
                onClick={() => props.onInput(example.expression)}
              >
                <span class="block text-[11px] font-medium text-secondary">{example.label}</span>
                <code class="block truncate font-mono text-[11px] text-dimmed">{example.expression}</code>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-label text-xs">Expression</span>
        <AutocompleteEditor
          value={props.value}
          onInput={props.onInput}
          placeholder="Reference fields by name. Leading = is optional."
          completions={completions()}
          highlight={formulaHighlight}
          restoreExpansionOnBackspace={false}
          lines={4}
          ariaLabel={props.ariaLabel ?? "Formula expression"}
        />
      </div>

      <p class="text-xs text-dimmed leading-snug">
        Formulas recompute on every read. Saved expressions keep readable names; renames are rewritten best effort.
      </p>

      <div class="flex flex-col gap-2">
        <FormulaPreview preview={preview()} loading={previewLoading()} />
        <Show when={referenceHref()}>
          <button type="button" class="btn-input btn-sm w-fit" onClick={() => openReferenceWindow(referenceHref())}>
            <i class="ti ti-external-link" /> Open reference
          </button>
        </Show>
      </div>
    </div>
  );
}
