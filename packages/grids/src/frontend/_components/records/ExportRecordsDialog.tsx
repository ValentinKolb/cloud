import { dialogCore, MultiSelectInput, PanelDialog, panelDialogOptions } from "@valentinkolb/cloud/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ExportBody, Field, RecordQuery } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

type RowState = {
  fieldId: string;
  enabled: boolean;
  label: string;
  relationMode: "ids" | "labels" | "fields";
  targetFieldIds: string[];
};

type OpenArgs = {
  tableId: string;
  fields: Field[];
  query: RecordQuery;
  viewColumns?: { fieldId: string }[];
};

const relationTargetTableId = (field: Field): string | null => {
  if (field.type !== "relation") return null;
  const id = (field.config as { targetTableId?: unknown }).targetTableId;
  return typeof id === "string" ? id : null;
};

const initialRows = (args: OpenArgs): RowState[] => {
  const visible = args.viewColumns?.length ? new Set(args.viewColumns.map((c) => c.fieldId)) : null;
  return args.fields
    .filter((f) => !f.deletedAt)
    .sort((a, b) => a.position - b.position)
    .map((field) => ({
      fieldId: field.id,
      enabled: visible ? visible.has(field.id) : !field.hideInTable,
      label: field.name,
      relationMode: "labels" as const,
      targetFieldIds: [],
    }));
};

const filenameFromDisposition = (header: string | null, fallback: string): string => {
  const match = header?.match(/filename="([^"]+)"/i);
  return match?.[1] ? decodeURIComponent(match[1]) : fallback;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const ExportDialogBody = (props: OpenArgs & { close: () => void }) => {
  const [format, setFormat] = createSignal<"csv" | "json">("csv");
  const [delimiter, setDelimiter] = createSignal<"," | ";" | "\t" | "|">(",");
  const [markdown, setMarkdown] = createSignal<"raw" | "html">("raw");
  const [rows, setRows] = createSignal<RowState[]>(initialRows(props));
  const [targetFields, setTargetFields] = createSignal<Record<string, Field[]>>({});
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fieldsById = new Map(props.fields.map((field) => [field.id, field]));

  onMount(() => {
    const targetIds = [...new Set(props.fields.map(relationTargetTableId).filter((id): id is string => !!id))];
    void Promise.all(
      targetIds.map(async (tableId) => {
        const res = await apiClient.fields["by-table"][":tableId"].$get({ param: { tableId } });
        if (!res.ok) return [tableId, []] as const;
        const fields = await res.json();
        return [tableId, fields.filter((f) => !f.deletedAt)] as const;
      }),
    ).then((entries) => setTargetFields(Object.fromEntries(entries)));
  });

  const updateRow = (index: number, patch: Partial<RowState>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const runExport = async () => {
    const selected = rows().filter((row) => row.enabled);
    if (selected.length === 0) {
      setError("Choose at least one field.");
      return;
    }

    const body: ExportBody = {
      format: format(),
      query: props.query,
      markdown: markdown(),
      csv: { delimiter: delimiter() },
      fields: selected.map((row) => {
        const field = fieldsById.get(row.fieldId);
        return {
          fieldId: row.fieldId,
          label: row.label.trim() || field?.name || "Field",
          relation:
            field?.type === "relation"
              ? {
                  mode: row.relationMode,
                  fieldIds: row.relationMode === "fields" ? row.targetFieldIds : undefined,
                }
              : undefined,
        };
      }),
    };

    setBusy(true);
    setError(null);
    try {
      // Blob download exception: native fetch keeps access to body + download headers.
      const res = await fetch(`/api/grids/records/by-table/${props.tableId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Export failed"));
      const blob = await res.blob();
      downloadBlob(blob, filenameFromDisposition(res.headers.get("Content-Disposition"), `grids-export.${format()}`));
      props.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelDialog>
      <PanelDialog.Header title="Export records" icon="ti ti-download" close={props.close} />
      <PanelDialog.Body>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="flex flex-col gap-1 text-xs font-medium text-primary">
            Format
            <select class="input" value={format()} onChange={(e) => setFormat(e.currentTarget.value as "csv" | "json")}>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <Show when={format() === "csv"}>
            <label class="flex flex-col gap-1 text-xs font-medium text-primary">
              Delimiter
              <select class="input" value={delimiter()} onChange={(e) => setDelimiter(e.currentTarget.value as "," | ";" | "\t" | "|")}>
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={"\t"}>Tab</option>
                <option value="|">Pipe</option>
              </select>
            </label>
          </Show>
          <label class="flex flex-col gap-1 text-xs font-medium text-primary">
            Markdown
            <select class="input" value={markdown()} onChange={(e) => setMarkdown(e.currentTarget.value as "raw" | "html")}>
              <option value="raw">Keep markdown</option>
              <option value="html">Convert to HTML</option>
            </select>
          </label>
        </div>

        <PanelDialog.Section title="Fields" subtitle="Pick exported columns and relation output." icon="ti ti-columns">
          <div class="flex max-h-[46vh] flex-col gap-2 overflow-y-auto">
            <For each={rows()}>
              {(row, index) => {
                const field = fieldsById.get(row.fieldId)!;
                const targetTableId = relationTargetTableId(field);
                const availableTargetFields = () =>
                  targetTableId ? (targetFields()[targetTableId] ?? []).sort((a, b) => a.position - b.position) : [];
                return (
                  <div class="rounded-lg border border-zinc-200/70 p-3 dark:border-zinc-800">
                    <div class="grid gap-2 sm:grid-cols-[1.4rem_1fr_1fr] sm:items-center">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => updateRow(index(), { enabled: e.currentTarget.checked })}
                        aria-label={`Export ${field.name}`}
                      />
                      <div class="min-w-0">
                        <div class="truncate text-xs font-medium text-primary">{field.name}</div>
                        <div class="text-[11px] text-dimmed">{field.type}</div>
                      </div>
                      <input
                        class="input input-sm"
                        value={row.label}
                        onInput={(e) => updateRow(index(), { label: e.currentTarget.value })}
                        disabled={!row.enabled}
                        aria-label={`Export label for ${field.name}`}
                      />
                    </div>
                    <Show when={field.type === "relation" && row.enabled}>
                      <div class="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
                        <select
                          class="input input-sm"
                          value={row.relationMode}
                          onChange={(e) => updateRow(index(), { relationMode: e.currentTarget.value as RowState["relationMode"] })}
                        >
                          <option value="ids">IDs</option>
                          <option value="labels">Labels</option>
                          <option value="fields">Selected fields</option>
                        </select>
                        <Show when={row.relationMode === "fields"}>
                          <MultiSelectInput
                            placeholder="Choose fields"
                            icon="ti ti-columns"
                            value={() => row.targetFieldIds}
                            onChange={(targetFieldIds) => updateRow(index(), { targetFieldIds })}
                            options={availableTargetFields().map((target) => ({
                              id: target.id,
                              label: target.name,
                              description: target.type,
                              icon: target.icon ?? "ti ti-columns",
                            }))}
                            clearable
                          />
                        </Show>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
          <Show when={error()}>
            <p class="text-xs text-red-600 dark:text-red-400">{error()}</p>
          </Show>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center gap-2">
          <button type="button" class="btn-simple btn-sm" onClick={props.close} disabled={busy()}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={() => void runExport()} disabled={busy()}>
            <i class={`ti ${busy() ? "ti-loader-2 animate-spin" : "ti-download"} text-sm`} />
            Export
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
};

export const openExportRecordsDialog = (args: OpenArgs): Promise<void> =>
  dialogCore.open<void>((close) => <ExportDialogBody {...args} close={close} />, panelDialogOptions);
