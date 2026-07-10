import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import {
  AutocompleteEditor,
  Checkbox,
  CheckboxCard,
  CopyButton,
  confirmDiscardIfDirty,
  dialogCore,
  IconInput,
  PanelDialog,
  Panes,
  type PanesValue,
  PdfPreview,
  panelDialogOptions,
  panelDialogWorkspaceOptions,
  prompts,
  TemplateEditor,
  type TemplateVariable,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { highlight } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { DocumentPreviewResponse, DocumentTemplate } from "../../../contracts";
import { DOCUMENT_TEMPLATE_STARTERS, type DocumentTemplateStarter } from "../../../document-template-starters";
import type { Field, Form, Table } from "../../../service";
import { requestDocumentTemplateDraftPreview } from "../documents/document-transfer-client";
import { createDraft } from "../editor-draft";
import { defaultConfigForType, TYPE_LABELS, TYPE_OPTIONS } from "../fields/field-config-editor";
import { FIELD_TYPE_ICONS } from "../fields/field-type-meta";
import { type TableHeader, TablePermissions } from "../fields/TableFieldDialogs";
import FormsManager from "../forms/FormsManager";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { buildBackendGqlCompletions } from "../query/query-autocomplete";
import RecordPicker from "../records/RecordPicker";
import { errorMessage } from "../utils/api-helpers";
import { RecordDisplayConfigEditor } from "./RecordDisplayConfigEditor";

const DOCUMENT_TEMPLATE_VARIABLES: TemplateVariable[] = [
  { name: "record", kind: "object" },
  { name: "table", kind: "object" },
  { name: "template", kind: "object" },
  { name: "run", kind: "object" },
  { name: "date", kind: "object" },
  { name: "rows", kind: "array" },
  { name: "columns", kind: "array" },
  { name: "query", kind: "object" },
  { name: "document", kind: "object" },
  { name: "snapshot", kind: "object" },
  { name: "app", kind: "object" },
  { name: "business", kind: "object" },
  { name: "images", kind: "array" },
  { name: "primaryImage", kind: "object" },
];

const createDocumentTemplatePanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "document-template-split",
    direction: "horizontal",
    sizes: [58, 42],
    children: [
      {
        type: "leaf",
        id: "document-template-html",
        elementIds: ["html", "header", "footer", "css"],
        activeElementId: "html",
        presentation: "tabs",
      },
      {
        type: "leaf",
        id: "document-template-preview",
        elementIds: ["preview", "data", "source", "permissions"],
        activeElementId: "preview",
        presentation: "tabs",
      },
    ],
  },
});

const documentGqlHighlight = highlight.compile(
  [
    { kind: "field", match: /"(?:""|[^"])*"/ },
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:from|table|view|select|join|left|as|on|where|formula|group|by|aggregate|having|sort|search|include|deleted|only|nulls|first|last|limit|offset|asc|desc|and|or|not)\b/i,
    },
    { kind: "function", match: /\b(?:count|countEmpty|countUnique|sum|avg|min|max|median|earliest|latest)\b/i },
    { kind: "placeholder", match: /\{[A-Za-z0-9_-]{1,200}\}/i },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

type DocumentDataTreeRow = {
  id: string;
  label: string;
  path: string;
  depth: number;
  value: unknown;
  copyText: string;
  loopText?: string;
};

const liquidPathKey = (key: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`);
const liquidPath = (parent: string, key: string) => `${parent}${liquidPathKey(key)}`;
const liquidValue = (path: string) => `{{ ${path} }}`;

const valueKind = (value: unknown): TemplateVariable["kind"] => {
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value && typeof value === "object") return "object";
  return "string";
};

const inlineValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value || '""';
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return `${Object.keys(value as Record<string, unknown>).length} keys`;
  return String(value);
};

const loopSnippet = (path: string, value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  const itemName = path === "rows" ? "row" : "item";
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const firstKey = Object.keys(first as Record<string, unknown>)[0];
    const body = firstKey ? `  {{ ${itemName}${liquidPathKey(firstKey)} }}` : `  {{ ${itemName} }}`;
    return `{% for ${itemName} in ${path} %}\n${body}\n{% endfor %}`;
  }
  return `{% for ${itemName} in ${path} %}\n  {{ ${itemName} }}\n{% endfor %}`;
};

const addDataTreeRows = (rows: DocumentDataTreeRow[], value: unknown, path: string, label: string, depth: number) => {
  rows.push({
    id: `${path}:${depth}`,
    label,
    path,
    depth,
    value,
    copyText: liquidValue(path),
    loopText: loopSnippet(path, value),
  });

  if (depth >= 4 || value === null || value === undefined || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 0) addDataTreeRows(rows, value[0], `${path}[0]`, "[0]", depth + 1);
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    addDataTreeRows(rows, child, liquidPath(path, key), key, depth + 1);
  }
};

const dataTreeRows = (data: Record<string, unknown> | null | undefined): DocumentDataTreeRow[] => {
  if (!data) return [];
  const rows: DocumentDataTreeRow[] = [];
  for (const key of ["record", "rows", "columns", "query", "table", "app", "business", "images", "primaryImage", "document", "snapshot"]) {
    if (key in data) addDataTreeRows(rows, data[key], key, key, 0);
  }
  return rows;
};

const templateVariablesFromData = (data: Record<string, unknown> | null | undefined): TemplateVariable[] =>
  dataTreeRows(data)
    .filter((row) => !row.path.includes("[0]"))
    .slice(0, 120)
    .map((row) => ({ name: row.path, kind: valueKind(row.value) }));

const diagnosticText = (diagnostic: { message: string; line?: number; column?: number }) =>
  diagnostic.line && diagnostic.column ? `Line ${diagnostic.line}, col ${diagnostic.column}: ${diagnostic.message}` : diagnostic.message;

const hasLiquidTags = (value: string) => /{{|{%/.test(value);

const readDocumentPreviewError = async (response: Response, fallback: string): Promise<{ message: string; phase: string | null }> => {
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object") {
      const message = Object.getOwnPropertyDescriptor(data, "message")?.value;
      const phase = Object.getOwnPropertyDescriptor(data, "phase")?.value;
      return {
        message: typeof message === "string" && message.length > 0 ? message : fallback,
        phase: typeof phase === "string" ? phase : null,
      };
    }
  } catch {
    // Fall back below.
  }
  return { message: fallback, phase: null };
};

export const openTableSettingsDialog = (args: {
  table: TableHeader;
  fields: Field[];
  initialAccessEntries: AccessEntry[];
  onSaved: (table: Table) => void;
  onDeleted?: () => void;
}) => dialogCore.open<void>((close) => <TableSettingsDialog args={args} close={close} />, panelDialogOptions);

function TableSettingsDialog(props: {
  args: {
    table: TableHeader;
    fields: Field[];
    initialAccessEntries: AccessEntry[];
    onSaved: (table: Table) => void;
    onDeleted?: () => void;
  };
  close: () => void;
}) {
  const [dirty, setDirty] = createSignal(false);
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  return (
    <PanelDialog>
      <PanelDialog.Header title={`Table settings — ${props.args.table.name}`} icon="ti ti-settings" close={closeIfClean} />
      <TableSettingsBody
        table={props.args.table}
        fields={props.args.fields}
        initialAccessEntries={props.args.initialAccessEntries}
        onDirtyChange={setDirty}
        onSaved={(table) => {
          setDirty(false);
          props.args.onSaved(table);
        }}
        onDeleted={props.args.onDeleted}
        onCancel={closeIfClean}
      />
    </PanelDialog>
  );
}

export const createFieldFromPrompt = async (args: { table: TableHeader }): Promise<Field | null> => {
  const type = await chooseFieldType();
  if (!type) return null;

  const result = await prompts.form({
    title: `Add ${TYPE_LABELS[type] ?? "field"}`,
    icon: FIELD_TYPE_ICONS[type] ?? "ti ti-plus",
    fields: {
      name: { type: "text", label: "Name", required: true, placeholder: "e.g. Status" },
    },
    confirmText: "Create",
    size: "small",
  });
  if (!result) return null;
  const name = String(result.name).trim();
  const res = await apiClient.fields["by-table"][":tableId"].$post({
    param: { tableId: args.table.id },
    json: { name, type, config: defaultConfigForType(type) },
  });
  if (!res.ok) {
    prompts.error(await errorMessage(res, "Failed to create field"));
    return null;
  }
  return res.json();
};

const FIELD_TYPE_EXAMPLES: Record<string, string> = {
  text: "Book title",
  longtext: "Internal notes in Markdown",
  number: "19.99 EUR",
  boolean: "Yes / no",
  date: "2026-05-15",
  select: "Status: shipped",
  id: "INV-00042",
  percent: "12.5%",
  duration: "01:30:00",
  json: '{ "raw": true }',
  file: "invoice.pdf",
  relation: "Customer -> Orders",
  lookup: "Customer email",
  rollup: "Sum order total",
  formula: "price * qty",
};

const FIELD_TYPE_PICKER_DESCRIPTIONS: Record<string, string> = {
  text: "Short values like names, titles, or codes.",
  longtext: "Paragraphs, notes, or Markdown content.",
  number: "Decimal-safe numbers with optional limits, units, and fixed places.",
  boolean: "A simple yes/no checkbox.",
  date: "Calendar dates, optionally with time.",
  select: "One or more options from a fixed list.",
  id: "Generated identifiers like inventory numbers, UUIDs, or short codes.",
  percent: "Percent values from 0 to 100.",
  duration: "Lengths of time in seconds or HH:MM:SS.",
  json: "Structured data when no type fits.",
  file: "Small files stored in Postgres.",
  relation: "Links to records in another table.",
  lookup: "Shows a value from a linked record.",
  rollup: "Aggregates values through a relation.",
  formula: "Computes a value from other fields.",
};

const CREATE_TYPE_OPTIONS = TYPE_OPTIONS.filter((type) => type.value !== "json");

const defaultDocumentSource = (tableId: string) => `from table {${tableId}}\nwhere record.id = '{{ record.id }}'\nlimit 1`;
const defaultDocumentNumberTemplate = "{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}";
const defaultDocumentFilenameTemplate = "{{ document.number }}.pdf";

const defaultDocumentStarter = (): DocumentTemplateStarter => ({
  id: "blank",
  name: "Blank template",
  description: "Simple record detail template.",
  icon: "ti ti-file-type-pdf",
  category: "Blank",
  bestFor: "Starting from a minimal record detail layout.",
  expectedData: "One selected record.",
  page: "A4 portrait",
  source: (tableId) => defaultDocumentSource(tableId),
  numberTemplate: defaultDocumentNumberTemplate,
  filenameTemplate: defaultDocumentFilenameTemplate,
  html: defaultDocumentHtml,
  headerHtml: "",
  footerHtml: "",
  pageCss: "",
});

const defaultDocumentHtml = `<html>
  <head>
    <style>
      body { font-family: system-ui, sans-serif; margin: 40px; color: #18181b; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 24px; }
      th, td { border-bottom: 1px solid #e4e4e7; padding: 8px; text-align: left; }
    </style>
  </head>
  <body>
    <h1>{{ table.name }} · {{ record.id }}</h1>
    <table>
      <tbody>
        {% for row in rows %}
          {% for column in columns %}
            <tr>
              <th>{{ column.label }}</th>
              <td>{{ row[column.key] }}</td>
            </tr>
          {% endfor %}
        {% endfor %}
      </tbody>
    </table>
  </body>
</html>`;

const starterPayload = (starter: DocumentTemplateStarter, tableId: string) => ({
  name: starter.id === "blank" ? "" : starter.name,
  description: starter.id === "blank" ? "" : starter.description,
  source: starter.source(tableId),
  numberTemplate: starter.numberTemplate ?? defaultDocumentNumberTemplate,
  filenameTemplate: starter.filenameTemplate ?? defaultDocumentFilenameTemplate,
  html: starter.html,
  headerHtml: starter.headerHtml ?? "",
  footerHtml: starter.footerHtml ?? "",
  pageCss: starter.pageCss ?? "",
});

type DocumentTemplateSnippet = {
  id: string;
  title: string;
  icon: string;
  value: () => string;
  onInput: (value: string) => void;
  placeholder: string;
};

const chooseFieldType = () =>
  dialogCore.open<string | null>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="Choose field type" icon="ti ti-plus" close={() => close(null)} />
        <PanelDialog.Body>
          <p class="text-sm text-secondary">Pick the basic data shape first. You can tune details after the field exists.</p>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <For each={CREATE_TYPE_OPTIONS}>
              {(type) => (
                <button type="button" class="paper p-3 text-left hover:paper-highlighted transition" onClick={() => close(type.value)}>
                  <div class="flex items-start gap-3">
                    <span class="thumbnail flex h-8 w-8 shrink-0 items-center justify-center bg-white shadow-[var(--theme-shadow-elevated)] dark:bg-zinc-950">
                      <i class={`${FIELD_TYPE_ICONS[type.value] ?? "ti ti-database"} text-base text-dimmed`} />
                    </span>
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-primary">{type.label}</div>
                      <div class="mt-1 truncate text-xs font-medium text-secondary">{FIELD_TYPE_EXAMPLES[type.value] ?? "Value"}</div>
                      <p class="mt-1 text-xs leading-snug text-dimmed">
                        {FIELD_TYPE_PICKER_DESCRIPTIONS[type.value] ?? "Store this value on each record."}
                      </p>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );

export const openFormsDialog = (args: {
  tableId: string;
  tableName: string;
  fields: Field[];
  initialForms: Form[];
  initialFormAccessEntries: Record<string, AccessEntry[]>;
  onFormsChanged?: (forms: Form[]) => void;
}) =>
  dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title={`Forms — ${args.tableName}`} icon="ti ti-forms" close={() => close()} />
        <PanelDialog.Body>
          <FormsManager
            tableId={args.tableId}
            fields={args.fields}
            initialForms={args.initialForms}
            initialFormAccessEntries={args.initialFormAccessEntries}
            onFormsChanged={args.onFormsChanged}
            canManage
          />
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );

export const deleteFieldWithChecks = async (field: Field): Promise<boolean> => {
  const depsRes = await apiClient.fields[":fieldId"].dependents.$get({ param: { fieldId: field.id } });
  if (depsRes.ok) {
    const deps = await depsRes.json();
    if (deps.hasBlocking) {
      const blockers = deps.dependents
        .filter((d) => d.blocking)
        .map((d) => `• ${d.type}: ${d.resourceName}`)
        .join("\n");
      prompts.error(`Cannot delete — remove these references first:\n\n${blockers}`);
      return false;
    }
  }
  const confirmed = await prompts.confirm(`Soft-delete "${field.name}"? Records keep their data; the column is hidden from the UI.`, {
    title: "Delete field?",
    variant: "danger",
    confirmText: "Delete",
  });
  if (!confirmed) return false;
  const res = await apiClient.fields[":fieldId"].$delete({ param: { fieldId: field.id } });
  if (res.status >= 400) {
    prompts.error(await errorMessage(res, "Failed to delete field"));
    return false;
  }
  return true;
};

function TableSettingsBody(props: {
  table: TableHeader;
  fields: Field[];
  initialAccessEntries: AccessEntry[];
  onSaved: (table: Table) => void;
  onDeleted?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}) {
  const draft = createDraft({
    name: props.table.name,
    description: props.table.description ?? "",
    icon: props.table.icon ?? "",
    displayConfig: props.table.displayConfig,
    disableDirectInsert: props.table.disableDirectInsert,
  });
  const patch = (partial: Partial<ReturnType<typeof draft.draft>>) => {
    draft.patch(partial);
    props.onDirtyChange?.(true);
  };
  const name = () => draft.draft().name;
  const description = () => draft.draft().description;
  const icon = () => draft.draft().icon;
  const displayConfig = () => draft.draft().displayConfig;
  const disableDirectInsert = () => draft.draft().disableDirectInsert;

  const saveMut = mutations.create<Table, void>({
    mutation: async () => {
      const trimmed = name().trim();
      if (!trimmed) throw new Error("Name is required");
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.table.id },
        json: {
          name: trimmed,
          description: description().trim() || null,
          icon: icon() || null,
          displayConfig: displayConfig(),
          disableDirectInsert: disableDirectInsert(),
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save table"));
      return res.json();
    },
    onSuccess: (next) => {
      draft.markSaved({
        name: next.name,
        description: next.description ?? "",
        icon: next.icon ?? "",
        displayConfig: next.displayConfig,
        disableDirectInsert: next.disableDirectInsert,
      });
      props.onDirtyChange?.(false);
      props.onSaved(next);
    },
    onError: (e) => prompts.error(e.message),
  });

  const deleteMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$delete({ param: { tableId: props.table.id } });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete table"));
    },
    onSuccess: () => {
      props.onDeleted?.();
      navigateTo(`/app/grids/${props.table.baseShortId}`);
    },
    onError: (e) => prompts.error(e.message),
  });

  const deleteTable = async () => {
    const ok = await prompts.confirm(`Delete "${name()}" and move its fields, records, files, and audit history out of the active app.`, {
      title: "Delete table?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (ok) deleteMut.mutate(undefined);
  };

  return (
    <>
      <PanelDialog.Body>
        <PanelDialog.Section title="Identity" subtitle="Name and description shown around this table." icon="ti ti-id">
          <TextInput label="Name" value={name} onInput={(v) => patch({ name: v })} icon="ti ti-typography" required />
          <IconInput label="Icon" value={icon} onChange={(v) => patch({ icon: v })} placeholder="Search icons..." />
          <TextInput
            label="Description"
            value={description}
            onInput={(v) => patch({ description: v })}
            icon="ti ti-align-left"
            multiline
            lines={2}
            placeholder="Optional"
          />
          <Checkbox
            label="Add records through forms"
            description="New records use forms by default. Admins can still edit the table directly."
            value={disableDirectInsert}
            onChange={(v) => patch({ disableDirectInsert: v })}
          />
        </PanelDialog.Section>

        <PanelDialog.Section title="Display" subtitle="Choose how records are shown on table pages." icon="ti ti-layout">
          <RecordDisplayConfigEditor
            value={displayConfig}
            onChange={(value) => patch({ displayConfig: value })}
            fields={() => props.fields}
          />
        </PanelDialog.Section>

        <PanelDialog.Section title="Permissions" subtitle="These permissions apply only to this table." icon="ti ti-lock">
          <TablePermissions tableId={props.table.id} initialEntries={props.initialAccessEntries} />
        </PanelDialog.Section>

        <PanelDialog.Section title="Danger zone" subtitle="Remove this table from the active app." icon="ti ti-trash">
          <button type="button" class="btn-danger btn-sm self-start" onClick={deleteTable} disabled={deleteMut.loading()}>
            <i class="ti ti-trash" /> Delete table
          </button>
        </PanelDialog.Section>
      </PanelDialog.Body>

      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => saveMut.mutate(undefined)}
            disabled={!draft.dirty() || saveMut.loading()}
          >
            {saveMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
          </button>
        </div>
      </PanelDialog.Footer>
    </>
  );
}

export const openDocumentTemplatesDialog = (args: { baseId: string; tableId: string; tableName: string }) =>
  dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title={`Templates — ${args.tableName}`} icon="ti ti-file-type-pdf" close={() => close()} />
        <PanelDialog.Body>
          <DocumentTemplatesManager baseId={args.baseId} tableId={args.tableId} tableName={args.tableName} />
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );

function DocumentTemplatesManager(props: { baseId: string; tableId: string; tableName: string }) {
  const [templates, { refetch }] = createResource(
    () => props.tableId,
    async (tableId) => {
      const res = await apiClient.documents.templates["by-table"][":tableId"].full.$get({ param: { tableId } });
      if (!res.ok) {
        prompts.error(await errorMessage(res, "Failed to load document templates"));
        return [] as DocumentTemplate[];
      }
      return res.json();
    },
  );

  const deleteTemplate = async (template: DocumentTemplate) => {
    const confirmed = await prompts.confirm(`Delete "${template.name}"? Existing generated documents can still be redownloaded.`, {
      title: "Delete document template?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    const res = await apiClient.documents.templates[":templateId"].$delete({ param: { templateId: template.id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to delete document template"));
      return;
    }
    await refetch();
  };

  const patchTemplate = async (template: DocumentTemplate, patch: Partial<Pick<DocumentTemplate, "enabled" | "position">>) => {
    const res = await apiClient.documents.templates[":templateId"].$patch({ param: { templateId: template.id }, json: patch });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to update document template"));
      return false;
    }
    await refetch();
    return true;
  };

  const duplicateTemplate = async (template: DocumentTemplate) => {
    const res = await apiClient.documents.templates["by-table"][":tableId"].$post({
      param: { tableId: props.tableId },
      json: {
        name: `${template.name} copy`,
        description: template.description,
        source: template.source,
        numberTemplate: template.numberTemplate,
        filenameTemplate: template.filenameTemplate,
        html: template.html,
        headerHtml: template.headerHtml,
        footerHtml: template.footerHtml,
        pageCss: template.pageCss,
        enabled: false,
      },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to duplicate document template"));
      return;
    }
    await refetch();
  };

  const moveTemplate = async (template: DocumentTemplate, direction: -1 | 1) => {
    const ordered = [...(templates() ?? [])].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    const index = ordered.findIndex((item) => item.id === template.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    await Promise.all([
      apiClient.documents.templates[":templateId"].$patch({
        param: { templateId: template.id },
        json: { position: swap.position },
      }),
      apiClient.documents.templates[":templateId"].$patch({
        param: { templateId: swap.id },
        json: { position: template.position },
      }),
    ]);
    await refetch();
  };

  const openEditor = (template?: DocumentTemplate, starter?: DocumentTemplateStarter) => {
    openDocumentTemplateEditorDialog({
      baseId: props.baseId,
      tableId: props.tableId,
      tableName: props.tableName,
      template,
      starter,
      onSaved: () => void refetch(),
    });
  };

  const addTemplate = async () => {
    const starter = await chooseDocumentTemplateStarter();
    if (starter) openEditor(undefined, starter);
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-dimmed">{templates.loading ? "Loading..." : `${templates()?.length ?? 0} templates`}</span>
        <button type="button" class="btn-input btn-sm" onClick={() => void addTemplate()}>
          <i class="ti ti-plus" /> Add template
        </button>
      </div>

      <Show when={!templates.loading && (templates()?.length ?? 0) === 0}>
        <div class="paper p-3 text-sm text-dimmed">No document templates yet.</div>
      </Show>

      <For each={[...(templates() ?? [])].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))}>
        {(template, index) => (
          <div class="paper flex items-start gap-3 p-3">
            <i class="ti ti-file-type-pdf mt-0.5 text-lg text-dimmed" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-semibold text-primary">{template.name}</span>
                <Show when={!template.enabled}>
                  <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-dimmed dark:bg-zinc-800">disabled</span>
                </Show>
              </div>
              <Show when={template.description}>
                <p class="mt-1 text-xs text-dimmed">{template.description}</p>
              </Show>
            </div>
            <button
              type="button"
              class="btn-simple btn-sm"
              title={template.enabled ? "Disable template" : "Enable template"}
              onClick={() => void patchTemplate(template, { enabled: !template.enabled })}
            >
              <i class={`ti ${template.enabled ? "ti-toggle-right" : "ti-toggle-left"}`} />
            </button>
            <button
              type="button"
              class="btn-simple btn-sm"
              title="Move up"
              disabled={index() === 0}
              onClick={() => void moveTemplate(template, -1)}
            >
              <i class="ti ti-arrow-up" />
            </button>
            <button
              type="button"
              class="btn-simple btn-sm"
              title="Move down"
              disabled={index() === (templates()?.length ?? 0) - 1}
              onClick={() => void moveTemplate(template, 1)}
            >
              <i class="ti ti-arrow-down" />
            </button>
            <button type="button" class="btn-simple btn-sm" title="Duplicate template" onClick={() => void duplicateTemplate(template)}>
              <i class="ti ti-copy" />
            </button>
            <button type="button" class="btn-simple btn-sm" title="Edit template" onClick={() => openEditor(template)}>
              <i class="ti ti-pencil" />
            </button>
            <button
              type="button"
              class="btn-simple btn-sm text-dimmed hover:text-red-500"
              title="Delete template"
              onClick={() => void deleteTemplate(template)}
            >
              <i class="ti ti-trash" />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}

const chooseDocumentTemplateStarter = () =>
  dialogCore.open<DocumentTemplateStarter | null>((close) => {
    const blank = defaultDocumentStarter();
    return (
      <PanelDialog>
        <PanelDialog.Header title="Choose template starter" icon="ti ti-file-type-pdf" close={() => close(null)} />
        <PanelDialog.Body>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            <For each={[blank, ...DOCUMENT_TEMPLATE_STARTERS]}>
              {(starter) => (
                <button type="button" class="paper p-3 text-left transition hover:paper-highlighted" onClick={() => close(starter)}>
                  <div class="flex items-start gap-3">
                    <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-white shadow-[var(--theme-shadow-elevated)] dark:bg-zinc-950">
                      <i class={`${starter.icon} text-lg text-primary`} />
                    </span>
                    <div class="min-w-0">
                      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <div class="truncate text-sm font-semibold text-primary">{starter.name}</div>
                        <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-dimmed dark:bg-zinc-800">
                          {starter.category}
                        </span>
                      </div>
                      <p class="mt-1 text-xs leading-snug text-dimmed">{starter.description}</p>
                      <div class="mt-2 grid gap-1 text-[11px] leading-snug text-dimmed">
                        <div>
                          <span class="font-medium text-secondary">Best for:</span> {starter.bestFor}
                        </div>
                        <div>
                          <span class="font-medium text-secondary">Data:</span> {starter.expectedData}
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{starter.page}</span>
                          <For each={starter.uses ?? []}>
                            {(use) => <span class="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{use}</span>}
                          </For>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </PanelDialog.Body>
      </PanelDialog>
    );
  }, panelDialogOptions);

function DocumentDataTree(props: { data: () => Record<string, unknown> | null; loading: () => boolean; error: () => string | null }) {
  const rows = createMemo(() => dataTreeRows(props.data()));
  return (
    <section class="paper min-h-0 flex-1 overflow-auto">
      <Show when={!props.loading()} fallback={<div class="p-3 text-sm text-dimmed">Loading preview data...</div>}>
        <Show
          when={props.error()}
          fallback={
            <Show
              when={rows().length > 0}
              fallback={<div class="p-3 text-sm text-dimmed">Choose a preview record to inspect available template data.</div>}
            >
              <div class="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
                <For each={rows()}>
                  {(row) => (
                    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5">
                      <div class="min-w-0" style={{ "padding-left": `${row.depth * 0.8}rem` }}>
                        <div class="flex min-w-0 items-center gap-2">
                          <span class={row.depth === 0 ? "font-semibold text-primary" : "text-secondary"}>{row.label}</span>
                          <code class="truncate text-[11px] text-dimmed">{row.path}</code>
                        </div>
                        <div class="truncate text-[11px] text-dimmed">{inlineValue(row.value)}</div>
                      </div>
                      <div class="flex items-center gap-1">
                        <Show when={row.loopText}>
                          {(snippet) => <CopyButton text={snippet()} label="Loop" class="btn-simple btn-sm" />}
                        </Show>
                        <CopyButton text={row.copyText} label="Copy" class="btn-simple btn-sm" />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          }
        >
          {(message) => <div class="m-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{message()}</div>}
        </Show>
      </Show>
    </section>
  );
}

function RenderedDocumentSource(props: { source: () => string | null; loading: () => boolean; error: () => string | null }) {
  const sourceText = () => props.source() ?? "";
  return (
    <section class="paper relative min-h-0 flex-1 overflow-hidden">
      <Show when={!props.loading()} fallback={<div class="p-3 text-sm text-dimmed">Rendering source...</div>}>
        <Show
          when={props.error()}
          fallback={
            <Show
              when={sourceText()}
              fallback={<div class="p-3 text-sm text-dimmed">Choose a preview record to inspect rendered GQL.</div>}
            >
              <pre class="h-full overflow-auto whitespace-pre-wrap p-3 pr-20 font-mono text-xs leading-relaxed text-secondary">
                {sourceText()}
              </pre>
              <div class="absolute right-2 top-2">
                <CopyButton text={sourceText()} label="Copy" class="btn-input btn-sm" />
              </div>
            </Show>
          }
        >
          {(message) => <div class="m-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{message()}</div>}
        </Show>
      </Show>
    </section>
  );
}

export function openDocumentTemplateEditorDialog(args: {
  baseId: string;
  tableId: string;
  tableName: string;
  template?: DocumentTemplate;
  starter?: DocumentTemplateStarter;
  onSaved?: (template: DocumentTemplate) => void;
}) {
  return dialogCore.open<void>((close) => <DocumentTemplateEditorDialog args={args} close={close} />, panelDialogWorkspaceOptions);
}

const templateReferenceHref = (baseShortId: string) => `/app/grids/${encodeURIComponent(baseShortId)}/reference/templates`;

const openTemplateReferenceWindow = (baseShortId: string) => {
  window.open(templateReferenceHref(baseShortId), "grids-template-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
};

function DocumentTemplateEditorDialog(props: {
  args: {
    baseId: string;
    tableId: string;
    tableName: string;
    template?: DocumentTemplate;
    starter?: DocumentTemplateStarter;
    onSaved?: (template: DocumentTemplate) => void;
  };
  close: () => void;
}) {
  const template = props.args.template;
  const initialStarter = starterPayload(props.args.starter ?? defaultDocumentStarter(), props.args.tableId);
  const [name, setName] = createSignal(template?.name ?? initialStarter.name);
  const [description, setDescription] = createSignal(template?.description ?? initialStarter.description);
  const [numberTemplate, setNumberTemplate] = createSignal(template?.numberTemplate ?? initialStarter.numberTemplate);
  const [filenameTemplate, setFilenameTemplate] = createSignal(template?.filenameTemplate ?? initialStarter.filenameTemplate);
  const [source, setSource] = createSignal(template?.source ?? initialStarter.source);
  const [html, setHtml] = createSignal(template?.html ?? initialStarter.html);
  const [headerHtml, setHeaderHtml] = createSignal(template?.headerHtml ?? initialStarter.headerHtml);
  const [footerHtml, setFooterHtml] = createSignal(template?.footerHtml ?? initialStarter.footerHtml);
  const [pageCss, setPageCss] = createSignal(template?.pageCss ?? initialStarter.pageCss);
  const [enabled, setEnabled] = createSignal(template?.enabled ?? false);
  const [previewRecordId, setPreviewRecordId] = createSignal("");
  const [templatePanes, setTemplatePanes] = createSignal<PanesValue>(createDocumentTemplatePanesValue());
  const [previewData, setPreviewData] = createSignal<DocumentPreviewResponse | null>(null);
  const [previewDataLoading, setPreviewDataLoading] = createSignal(false);
  const [previewDataError, setPreviewDataError] = createSignal<string | null>(null);
  const [previewSourceError, setPreviewSourceError] = createSignal<string | null>(null);
  const [lastSuccessfulPreviewSignature, setLastSuccessfulPreviewSignature] = createSignal<string | null>(null);
  const [gqlDiagnostics, setGqlDiagnostics] = createSignal<Array<{ message: string; line?: number; column?: number }>>([]);
  const [gqlDiagnosticError, setGqlDiagnosticError] = createSignal<string | null>(null);
  const [templateAccessEntries] = createResource(
    () => template?.id ?? "",
    async (templateId) => {
      if (!templateId) return [] as AccessEntry[];
      const res = await apiClient.access["by-document-template"][":templateId"].$get({ param: { templateId } });
      if (!res.ok) return [] as AccessEntry[];
      return res.json();
    },
  );
  const gqlCompletions = createMemo(() =>
    buildBackendGqlCompletions({
      currentSource: { kind: "table", tableId: props.args.tableId },
      fetchAutocomplete: async (request, signal) => {
        const response = await apiClient.gql["by-base"][":baseId"].autocomplete.$post(
          { param: { baseId: props.args.baseId }, json: request },
          { init: { signal } },
        );
        if (!response.ok) throw new Error(await errorMessage(response, "Could not load query suggestions."));
        return response.json();
      },
    }),
  );
  const templateVariables = createMemo<TemplateVariable[]>(() => {
    const byName = new Map<string, TemplateVariable>();
    for (const variable of [...DOCUMENT_TEMPLATE_VARIABLES, ...templateVariablesFromData(previewData()?.data)])
      byName.set(variable.name, variable);
    return [...byName.values()];
  });
  const templateSnippets = createMemo<DocumentTemplateSnippet[]>(() => [
    {
      id: "html",
      title: "Body",
      icon: "ti ti-code",
      value: html,
      onInput: setHtml,
      placeholder: "Write the main document HTML...",
    },
    {
      id: "header",
      title: "Header",
      icon: "ti ti-layout-navbar",
      value: headerHtml,
      onInput: setHeaderHtml,
      placeholder: "Optional Gotenberg header HTML...",
    },
    {
      id: "footer",
      title: "Footer",
      icon: "ti ti-layout-bottombar",
      value: footerHtml,
      onInput: setFooterHtml,
      placeholder: "Optional Gotenberg footer HTML...",
    },
    {
      id: "css",
      title: "Page CSS",
      icon: "ti ti-braces",
      value: pageCss,
      onInput: setPageCss,
      placeholder: "@page { size: A4; margin: 28mm 14mm 22mm; }",
    },
  ]);
  const dirty = () =>
    name() !== (template?.name ?? initialStarter.name) ||
    description() !== (template?.description ?? initialStarter.description) ||
    numberTemplate() !== (template?.numberTemplate ?? initialStarter.numberTemplate) ||
    filenameTemplate() !== (template?.filenameTemplate ?? initialStarter.filenameTemplate) ||
    source() !== (template?.source ?? initialStarter.source) ||
    html() !== (template?.html ?? initialStarter.html) ||
    headerHtml() !== (template?.headerHtml ?? initialStarter.headerHtml) ||
    footerHtml() !== (template?.footerHtml ?? initialStarter.footerHtml) ||
    pageCss() !== (template?.pageCss ?? initialStarter.pageCss) ||
    enabled() !== (template?.enabled ?? false);

  const currentPreviewSignature = () =>
    JSON.stringify({
      source: source().trim(),
      html: html().trim(),
      headerHtml: headerHtml().trim() || null,
      footerHtml: footerHtml().trim() || null,
      pageCss: pageCss().trim() || null,
      numberTemplate: numberTemplate().trim(),
      filenameTemplate: filenameTemplate().trim(),
      recordId: previewRecordId().trim(),
    });
  const hasCurrentSuccessfulPreview = () => lastSuccessfulPreviewSignature() === currentPreviewSignature();

  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };

  const saveMut = mutations.create<DocumentTemplate, void>({
    mutation: async () => {
      const payload = {
        name: name().trim(),
        description: description().trim() || null,
        numberTemplate: numberTemplate().trim(),
        filenameTemplate: filenameTemplate().trim(),
        source: source().trim(),
        html: html().trim(),
        headerHtml: headerHtml().trim() || null,
        footerHtml: footerHtml().trim() || null,
        pageCss: pageCss().trim() || null,
        enabled: enabled(),
      };
      if (!payload.name) throw new Error("Name is required");
      if (!payload.numberTemplate) throw new Error("Document number pattern is required");
      if (!payload.filenameTemplate) throw new Error("Filename template is required");
      if (!payload.source) throw new Error("GQL source is required");
      if (!payload.html) throw new Error("HTML template is required");
      const res = template
        ? await apiClient.documents.templates[":templateId"].$patch({ param: { templateId: template.id }, json: payload })
        : await apiClient.documents.templates["by-table"][":tableId"].$post({ param: { tableId: props.args.tableId }, json: payload });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save document template"));
      return res.json();
    },
    onSuccess: (saved) => {
      props.args.onSaved?.(saved);
      props.close();
    },
    onError: (e) => prompts.error(e.message),
  });

  const previewPdf = async () => {
    const recordId = previewRecordId().trim();
    if (!recordId) throw new Error("Preview record ID is required");
    const payload = {
      source: source().trim(),
      html: html().trim(),
      headerHtml: headerHtml().trim() || null,
      footerHtml: footerHtml().trim() || null,
      pageCss: pageCss().trim() || null,
      numberTemplate: numberTemplate().trim(),
      filenameTemplate: filenameTemplate().trim(),
      recordId,
    };
    const signature = currentPreviewSignature();
    const response = await requestDocumentTemplateDraftPreview({
      tableId: props.args.tableId,
      templateId: template?.id,
      draft: payload,
    });
    if (response.ok) setLastSuccessfulPreviewSignature(signature);
    return response;
  };

  const saveTemplate = async () => {
    const warnings: string[] = [];
    if (gqlDiagnosticError()) warnings.push(gqlDiagnosticError()!);
    if (previewSourceError()) warnings.push(previewSourceError()!);
    if (gqlDiagnostics().length > 0) warnings.push(...gqlDiagnostics().slice(0, 3).map(diagnosticText));
    if (enabled() && !hasCurrentSuccessfulPreview()) {
      warnings.push("This enabled template has not rendered a successful PDF preview for the current draft.");
    }
    if (warnings.length > 0) {
      const confirmed = await prompts.confirm(`Save this template anyway?\n\n${warnings.map((warning) => `• ${warning}`).join("\n")}`, {
        title: "Template has warnings",
        confirmText: "Save anyway",
      });
      if (!confirmed) return;
    }
    saveMut.mutate(undefined);
  };

  let previewDataToken = 0;
  let gqlDiagnosticsToken = 0;
  createEffect(() => {
    const sourceText = source().trim();
    if (!sourceText || hasLiquidTags(sourceText)) {
      gqlDiagnosticsToken += 1;
      setGqlDiagnostics([]);
      setGqlDiagnosticError(null);
      return;
    }

    const token = ++gqlDiagnosticsToken;
    const timeout = window.setTimeout(async () => {
      try {
        const response = await apiClient.gql["by-base"][":baseId"].autocomplete.$post({
          param: { baseId: props.args.baseId },
          json: {
            query: sourceText,
            caret: sourceText.length,
            currentTableId: props.args.tableId,
            currentSource: { kind: "table", tableId: props.args.tableId },
          },
        });
        if (token !== gqlDiagnosticsToken) return;
        if (!response.ok) throw new Error(await errorMessage(response, "Could not validate GQL source"));
        const data = await response.json();
        setGqlDiagnostics(data.diagnostics ?? []);
        setGqlDiagnosticError(null);
      } catch (e) {
        if (token === gqlDiagnosticsToken) {
          setGqlDiagnostics([]);
          setGqlDiagnosticError(e instanceof Error ? e.message : "Could not validate GQL source");
        }
      }
    }, 300);
    onCleanup(() => window.clearTimeout(timeout));
  });

  createEffect(() => {
    const recordId = previewRecordId().trim();
    const sourceText = source().trim();
    const htmlText = html().trim();
    const headerHtmlText = headerHtml().trim();
    const footerHtmlText = footerHtml().trim();
    const pageCssText = pageCss().trim();
    const numberTemplateText = numberTemplate().trim();
    const filenameTemplateText = filenameTemplate().trim();
    if (!recordId || !sourceText || !htmlText) {
      previewDataToken += 1;
      setPreviewData(null);
      setPreviewDataError(null);
      setPreviewSourceError(null);
      setPreviewDataLoading(false);
      return;
    }

    const token = ++previewDataToken;
    setPreviewDataLoading(true);
    setPreviewDataError(null);
    setPreviewSourceError(null);
    const timeout = window.setTimeout(async () => {
      try {
        const payload = {
          source: sourceText,
          html: htmlText,
          headerHtml: headerHtmlText || null,
          footerHtml: footerHtmlText || null,
          pageCss: pageCssText || null,
          numberTemplate: numberTemplateText,
          filenameTemplate: filenameTemplateText,
          recordId,
        };
        const response = template
          ? await apiClient.documents.templates[":templateId"]["preview-data-draft"].$post({
              param: { templateId: template.id },
              json: payload,
            })
          : await apiClient.documents.templates["by-table"][":tableId"]["preview-data-draft"].$post({
              param: { tableId: props.args.tableId },
              json: payload,
            });
        if (token !== previewDataToken) return;
        if (!response.ok) {
          const details = await readDocumentPreviewError(response, "Could not load preview data");
          setPreviewSourceError(details.phase === "source" ? details.message : null);
          throw new Error(details.message);
        }
        setPreviewData(await response.json());
        setPreviewSourceError(null);
      } catch (e) {
        if (token === previewDataToken) {
          setPreviewData(null);
          setPreviewDataError(e instanceof Error ? e.message : "Could not load preview data");
        }
      } finally {
        if (token === previewDataToken) setPreviewDataLoading(false);
      }
    }, 350);
    onCleanup(() => window.clearTimeout(timeout));
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={`${template ? "Edit" : "Add"} template — ${props.args.tableName}`}
        icon="ti ti-file-type-pdf"
        close={closeIfClean}
        actions={
          <button type="button" class="btn-input btn-sm" onClick={() => openTemplateReferenceWindow(props.args.baseId)}>
            <i class="ti ti-external-link" /> Reference
          </button>
        }
      />
      <PanelDialog.Body>
        <div class="flex h-full min-h-0 flex-col gap-2">
          <div class="grid shrink-0 gap-2 lg:grid-cols-2">
            <TextInput label="Name" value={name} onInput={setName} icon="ti ti-typography" required />
            <TextInput label="Description" value={description} onInput={setDescription} icon="ti ti-align-left" placeholder="Optional" />
            <div>
              <TextInput
                label="Document number"
                description="Liquid pattern for stable generated document numbers."
                value={numberTemplate}
                onInput={setNumberTemplate}
                icon="ti ti-hash"
                placeholder={defaultDocumentNumberTemplate}
                required
              />
            </div>
            <div>
              <TextInput
                label="Filename"
                description="Liquid pattern for generated PDF filenames. Users can edit the final filename before generating."
                value={filenameTemplate}
                onInput={setFilenameTemplate}
                icon="ti ti-file-text"
                placeholder="{{ document.number }}.pdf"
                required
              />
            </div>
            <div class="lg:col-span-2">
              <CheckboxCard
                value={enabled}
                onChange={setEnabled}
                label="Enabled"
                description="Enabled templates appear in document generation lists and the Documents sidebar."
                icon="ti ti-file-check"
                variant="input"
              />
            </div>
            <div class="lg:col-span-2">
              <RecordPicker
                tableId={props.args.tableId}
                templateId={template?.id}
                label="Preview record"
                value={previewRecordId}
                onChange={setPreviewRecordId}
                placeholder="Search preview record..."
              />
            </div>
            <div class="lg:col-span-2">
              <div class="mb-1.5 flex items-center justify-between gap-2">
                <div class="text-sm font-medium text-primary">
                  GQL source <span class="text-red-500">*</span>
                </div>
                <span class="text-xs text-dimmed">Scoped to {props.args.tableName}</span>
              </div>
              <AutocompleteEditor
                value={source}
                onInput={setSource}
                completions={gqlCompletions()}
                highlight={documentGqlHighlight}
                lines={4}
                placeholder={`from table ${props.args.tableName}\nwhere record.id = "{{ record.id }}"\nlimit 1`}
                spellcheck={false}
                ariaLabel="GQL source"
              />
              <Show when={gqlDiagnosticError() || previewSourceError() || gqlDiagnostics().length > 0}>
                <div class="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                  <Show
                    when={gqlDiagnosticError() || previewSourceError()}
                    fallback={
                      <ul class="grid gap-1">
                        <For each={gqlDiagnostics().slice(0, 4)}>{(diagnostic) => <li>{diagnosticText(diagnostic)}</li>}</For>
                      </ul>
                    }
                  >
                    {(message) => message()}
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          <Panes.Root
            value={templatePanes()}
            onChange={setTemplatePanes}
            class="min-h-[24rem] w-full flex-1"
            allowResize
            allowMove={false}
            allowReorder={false}
            allowHorizontalSplit={false}
            allowVerticalSplit={false}
            leafPresentation="single"
          >
            <For each={templateSnippets()}>
              {(snippet) => (
                <Panes.Element id={snippet.id} title={snippet.title} icon={snippet.icon}>
                  <section class="flex h-full min-h-0 flex-col overflow-hidden">
                    <TemplateEditor
                      value={snippet.value}
                      onInput={snippet.onInput}
                      variables={templateVariables()}
                      fill
                      placeholder={snippet.placeholder}
                    />
                  </section>
                </Panes.Element>
              )}
            </For>

            <Panes.Element id="preview" title="Preview" icon="ti ti-file-type-pdf">
              <section class="flex h-full min-h-0 flex-col overflow-hidden">
                <PdfPreview
                  title="Gotenberg PDF preview"
                  class="min-h-0 flex-1"
                  buttonLabel="Render preview"
                  emptyText="Choose a record and render a PDF preview from the unsaved draft."
                  disabled={() => !source().trim() || !html().trim() || !previewRecordId().trim()}
                  request={previewPdf}
                />
              </section>
            </Panes.Element>
            <Panes.Element id="data" title="Data" icon="ti ti-list-tree">
              <section class="flex h-full min-h-0 flex-col overflow-hidden">
                <DocumentDataTree data={() => previewData()?.data ?? null} loading={previewDataLoading} error={previewDataError} />
              </section>
            </Panes.Element>
            <Panes.Element id="source" title="Source" icon="ti ti-code">
              <section class="flex h-full min-h-0 flex-col overflow-hidden">
                <RenderedDocumentSource
                  source={() => previewData()?.source ?? null}
                  loading={previewDataLoading}
                  error={previewDataError}
                />
              </section>
            </Panes.Element>
            <Panes.Element id="permissions" title="Access" icon="ti ti-lock">
              <section class="flex h-full min-h-0 flex-col overflow-y-auto p-3">
                <Show
                  when={template}
                  fallback={<div class="p-3 text-sm text-dimmed">Save the template before configuring document access.</div>}
                >
                  {(savedTemplate) => (
                    <Show when={!templateAccessEntries.loading} fallback={<div class="p-3 text-sm text-dimmed">Loading access…</div>}>
                      <ScopedPermissionEditor
                        scope={{ type: "documentTemplate", id: savedTemplate().id }}
                        initialEntries={templateAccessEntries() ?? []}
                        allowedLevels={[
                          { level: "read", label: "Read", icon: "ti ti-eye" },
                          { level: "write", label: "Write", icon: "ti ti-pencil" },
                          { level: "admin", label: "Admin", icon: "ti ti-shield" },
                        ]}
                      />
                    </Show>
                  )}
                </Show>
              </section>
            </Panes.Element>
          </Panes.Root>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={closeIfClean}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={() => void saveTemplate()} disabled={saveMut.loading()}>
            {saveMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save template"}
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
