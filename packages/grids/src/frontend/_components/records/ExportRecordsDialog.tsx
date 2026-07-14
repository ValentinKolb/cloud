import { Checkbox, dialogCore, MultiSelectInput, PanelDialog, panelDialogOptions, Select, TextInput } from "@valentinkolb/cloud/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ExportBody, Field, RecordQuery } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";
import { requestRecordExport } from "./record-transfer-client";

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
      const res = await requestRecordExport(props.tableId, body);
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
          <Select
            label="Format"
            value={format}
            onChange={(value) => setFormat(value as "csv" | "json")}
            options={[
              { id: "csv", label: "CSV" },
              { id: "json", label: "JSON" },
            ]}
          />
          <Show when={format() === "csv"}>
            <Select
              label="Delimiter"
              value={delimiter}
              onChange={(value) => setDelimiter(value as "," | ";" | "\t" | "|")}
              options={[
                { id: ",", label: "Comma" },
                { id: ";", label: "Semicolon" },
                { id: "\t", label: "Tab" },
                { id: "|", label: "Pipe" },
              ]}
            />
          </Show>
          <Select
            label="Markdown"
            value={markdown}
            onChange={(value) => setMarkdown(value as "raw" | "html")}
            options={[
              { id: "raw", label: "Keep markdown" },
              { id: "html", label: "Convert to HTML" },
            ]}
          />
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
                  <div class="px-1 py-2">
                    <div class="grid gap-2 sm:grid-cols-2 sm:items-start">
                      <Checkbox
                        label={field.name}
                        description={field.type}
                        value={() => row.enabled}
                        onChange={(enabled) => updateRow(index(), { enabled })}
                      />
                      <TextInput
                        label="Column label"
                        value={() => row.label}
                        onInput={(label) => updateRow(index(), { label })}
                        disabled={!row.enabled}
                      />
                    </div>
                    <Show when={field.type === "relation" && row.enabled}>
                      <div class="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr]">
                        <Select
                          label="Relation output"
                          value={() => row.relationMode}
                          onChange={(relationMode) => updateRow(index(), { relationMode: relationMode as RowState["relationMode"] })}
                          options={[
                            { id: "ids", label: "IDs" },
                            { id: "labels", label: "Labels" },
                            { id: "fields", label: "Selected fields" },
                          ]}
                        />
                        <Show when={row.relationMode === "fields"}>
                          <MultiSelectInput
                            label="Target fields"
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
