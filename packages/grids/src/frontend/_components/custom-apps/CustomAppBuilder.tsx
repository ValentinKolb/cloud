import type { DateContext } from "@k2b/stdlib";
import { dnd, mutation as mutations } from "@k2b/stdlib/solid";
import {
  AppWorkspace,
  Button,
  ButtonLink,
  DetailPanel,
  Disclosure,
  Dropdown,
  IconButton,
  IconInput,
  MultiSelectInput,
  NoticeCard,
  NumberInput,
  prompts,
  Select,
  StatusBadge,
  Switch,
  TextInput,
  Toolbar,
} from "@k2b/ui";
import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewResponse } from "../../../contracts";
import type { CustomAppAction, CustomAppBlock, CustomAppDefinition, CustomAppDiagnostic } from "../../../custom-apps/contracts";
import type { DslQueryContextKey } from "../../../query-dsl/parameters";
import type { CustomApp, Field, View } from "../../../service";
import type { CustomAppDraftSave } from "../../../service/custom-apps";
import { type CustomAppBlockDragMeta, type CustomAppBlockDropMeta, CustomAppPageLayout } from "../../custom-app/PageLayout";
import { isRecordInputField } from "../fields/field-render";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceCatalog } from "../workspace/workspace-state-model";
import CustomAppBlockPreview from "./CustomAppBlockPreview";
import { CustomAppAvailabilitySection, CustomAppGqlField } from "./CustomAppGqlField";
import {
  applyCustomAppBlockDrop,
  type CustomAppBlockDropIntent,
  type CustomAppLayoutIds,
  normalizeCustomAppPageLayout,
  sameCustomAppBlockDropIntent,
  selectCustomAppBlockDropTarget,
} from "./custom-app-builder-dnd";
import {
  customAppPageParameterUsage,
  moveCustomAppPage,
  removeCustomAppPageParameter,
  renameCustomAppPageParameter,
} from "./custom-app-builder-model";
import { createCustomAppBuilderState } from "./custom-app-builder-state";

type CustomAppPage = CustomAppDefinition["pages"][number];
type CustomAppRow = CustomAppPage["rows"][number];
type CustomAppColumn = CustomAppRow["columns"][number];
type SelectedBlock = {
  block: CustomAppBlock;
  blockIndex: number;
  column: CustomAppColumn;
  row: CustomAppRow;
};
type SelectedAction = { action: CustomAppAction; index: number };
type CustomAppWorkflowLauncher = WorkspaceCatalog["workflowLaunchers"][number] & {
  config: Extract<WorkspaceCatalog["workflowLaunchers"][number]["config"], { kind: "customApp" }>;
};

const iconInputValue = (slug: string | undefined): string | null => (slug ? `ti ti-${slug}` : null);
const iconSlug = (value: string | null): string | undefined => value?.replace(/^ti ti-/, "") || undefined;

const localId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const chartTypeFrom = (value: string): Extract<CustomAppBlock, { type: "chart" }>["chartType"] | null => {
  switch (value) {
    case "bar":
    case "line":
    case "donut":
    case "sparkline":
    case "scatter":
      return value;
    default:
      return null;
  }
};

const fieldsForView = (view: View, fieldsByTable: WorkspaceCatalog["fieldsByTable"], fieldsById: ReadonlyMap<string, Field>): Field[] => {
  const tableFields = (fieldsByTable[view.tableId] ?? [])
    .filter((field) => field.deletedAt === null)
    .sort((left, right) => left.position - right.position);
  const configured = (view.ui.columns ?? [])
    .flatMap((column) => ("fieldId" in column ? [fieldsById.get(column.fieldId)] : []))
    .filter((field): field is Field => Boolean(field && field.deletedAt === null));
  if (configured.length > 0) return configured.slice(0, 30);
  const visible = tableFields.filter((field) => !field.hideInTable);
  return (visible.length > 0 ? visible : tableFields).slice(0, 30);
};

const blockMeta: Record<CustomAppBlock["type"], { icon: string; label: string }> = {
  actions: { icon: "ti ti-bolt", label: "Actions" },
  chart: { icon: "ti ti-chart-bar", label: "Chart" },
  comments: { icon: "ti ti-messages", label: "Comments" },
  form: { icon: "ti ti-forms", label: "Form" },
  markdown: { icon: "ti ti-markdown", label: "Markdown" },
  metrics: { icon: "ti ti-chart-dots", label: "Metrics" },
  record: { icon: "ti ti-id", label: "Record" },
  records: { icon: "ti ti-table", label: "Records" },
};

export const isCustomAppBlockSourceDiagnostic = (diagnostic: CustomAppDiagnostic, blockId: string): boolean =>
  diagnostic.path.includes(blockId) && diagnostic.path.includes("source");

export const isCustomAppAvailabilityDiagnostic = (diagnostic: CustomAppDiagnostic, targetId: string): boolean =>
  diagnostic.path.includes(targetId) && diagnostic.path.includes("availableWhen");

const FIXED_CUSTOM_APP_CONTEXT_KEYS = [
  "auth.id",
  "page.id",
  "page.title",
  "page.url",
  "app.id",
  "app.shortId",
  "app.name",
  "base.id",
  "base.name",
  "time.now",
  "time.today",
  "time.timeZone",
] as const satisfies readonly DslQueryContextKey[];

export const customAppContextKeys = (page: CustomAppPage): DslQueryContextKey[] => [
  ...FIXED_CUSTOM_APP_CONTEXT_KEYS,
  ...Object.keys(page.parameters).map((parameterId): DslQueryContextKey => `params.${parameterId}`),
];

export const blankCustomAppDefinition = (app: CustomApp): CustomAppDefinition => ({
  schemaVersion: 2,
  kind: "grids.custom-app",
  id: app.id,
  shortId: app.shortId,
  baseId: app.baseId,
  name: app.name,
  ...(app.icon ? { icon: app.icon } : {}),
  startPageId: "home",
  pages: [
    {
      id: "home",
      title: "Home",
      navigation: { visible: true, order: 0 },
      parameters: {},
      rows: [
        {
          id: "content",
          columns: [{ id: "main", span: 12, blocks: [{ id: "intro", type: "markdown", markdown: "" }] }],
        },
      ],
    },
  ],
});

const downloadRawDefinition = (app: CustomApp) => {
  const href = URL.createObjectURL(new Blob([`${JSON.stringify(app.draftDefinitionRaw, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `custom-app-${app.shortId}-draft.json`;
  anchor.click();
  URL.revokeObjectURL(href);
};

function PageParameterIdInput(props: { id: string; existingIds: readonly string[]; onRename: (id: string) => void }) {
  const [value, setValue] = createSignal(props.id);
  const error = createMemo(() => {
    const next = value().trim();
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(next)) return "Use lowercase letters, numbers, and underscores.";
    if (next !== props.id && props.existingIds.includes(next)) return "This parameter ID is already used.";
    return undefined;
  });
  createEffect(() => setValue(props.id));
  const commit = () => {
    const next = value().trim();
    if (!error() && next !== props.id) props.onRename(next);
  };
  return <TextInput label="Parameter ID" value={value} onValueChange={setValue} error={error} onBlur={commit} required />;
}

function JsonValueInput(props: { label: string; value: WorkflowJsonValue; onValueChange: (value: WorkflowJsonValue) => void }) {
  const serialize = () => JSON.stringify(props.value, null, 2) ?? "null";
  const [value, setValue] = createSignal(serialize());
  const [error, setError] = createSignal<string>();
  createEffect(() => setValue(serialize()));
  const commit = () => {
    try {
      props.onValueChange(JSON.parse(value()) as WorkflowJsonValue);
      setError(undefined);
    } catch {
      setError("Enter valid JSON before leaving this field.");
    }
  };
  return (
    <TextInput
      label={props.label}
      description="JSON supports text, numbers, booleans, arrays, objects, and null."
      value={value}
      onValueChange={setValue}
      onBlur={commit}
      error={error}
      markdown
    />
  );
}

function InvalidCustomAppDraft(props: { app: CustomApp }) {
  const replaceMutation = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "Replace the stored draft with a new blank schema v2 definition? Download the stored JSON first if you still need it.",
        {
          title: "Replace incompatible draft",
          icon: "ti ti-file-plus",
          confirmText: "Replace draft",
          variant: "danger",
        },
      );
      if (!confirmed) return;
      const response = await apiClient.apps[":appId"].draft.$put(
        { param: { appId: props.app.id }, json: { definition: blankCustomAppDefinition(props.app) } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not replace the incompatible draft."));
      window.location.reload();
    },
    onError: (error) => prompts.error(error.message),
  });
  const restoreMutation = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const response = await apiClient.apps[":appId"].restore.$post({ param: { appId: props.app.id } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not restore the live version."));
      window.location.reload();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <AppWorkspace.Main class="p-4" mobilePane="main">
      <div class="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <NoticeCard
          tone="danger"
          title="This draft cannot be opened"
          detail="The stored definition is preserved, but this editor only accepts Custom App schema v2. Nothing will run or publish until you choose a recovery action."
          role="alert"
        >
          <ul class="list-disc space-y-1 pl-4 text-sm">
            <For each={props.app.draftDiagnostics}>{(diagnostic) => <li>{diagnostic.message}</li>}</For>
          </ul>
        </NoticeCard>
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadRawDefinition(props.app)}>
            <i class="ti ti-download" aria-hidden="true" /> Download stored JSON
          </Button>
          <Show when={props.app.publishedDefinition}>
            <Button
              variant="secondary"
              loading={restoreMutation.loading()}
              disabled={replaceMutation.loading()}
              onClick={() => restoreMutation.mutate(undefined)}
            >
              <i class="ti ti-restore" aria-hidden="true" /> Restore live version
            </Button>
          </Show>
          <Button
            variant="danger"
            loading={replaceMutation.loading()}
            disabled={restoreMutation.loading()}
            onClick={() => replaceMutation.mutate(undefined)}
          >
            <i class="ti ti-file-plus" aria-hidden="true" /> Replace with blank schema v2 draft
          </Button>
        </div>
      </div>
    </AppWorkspace.Main>
  );
}

const newPage = (definition: CustomAppDefinition): CustomAppPage => {
  const pageNumber = definition.pages.length + 1;
  return {
    id: localId("page"),
    title: `Page ${pageNumber}`,
    navigation: {
      visible: true,
      order: Math.max(-1, ...definition.pages.map((page) => page.navigation.order)) + 1,
    },
    parameters: {},
    rows: [
      {
        id: localId("row"),
        columns: [
          {
            id: localId("column"),
            span: 12,
            blocks: [{ id: localId("markdown"), type: "markdown", markdown: "" }],
          },
        ],
      },
    ],
  };
};

type CustomAppBuilderProps = {
  app: CustomApp;
  catalog: WorkspaceCatalog;
  dateConfig?: DateContext;
  initialPreviewResults?: Record<string, DslQueryPreviewResponse>;
  initialInspectorMode?: "app" | "page";
};

export default function CustomAppBuilder(props: CustomAppBuilderProps) {
  if (!props.app.draftDefinition) return <InvalidCustomAppDraft app={props.app} />;
  return <CustomAppBuilderEditor {...props} initialDefinition={props.app.draftDefinition} />;
}

function CustomAppBuilderEditor(props: CustomAppBuilderProps & { initialDefinition: CustomAppDefinition }) {
  const [app, setApp] = createSignal(props.app);
  const draft = createCustomAppBuilderState(props.initialDefinition);
  const [diagnostics, setDiagnostics] = createSignal<CustomAppDiagnostic[]>([]);
  const [saveState, setSaveState] = createSignal<"idle" | "saving" | "saved" | "error" | "invalid">(
    props.app.draftValid === false ? "invalid" : "idle",
  );
  const [saveError, setSaveError] = createSignal<string | null>(
    props.app.draftValid === false ? "The saved draft must be fixed before it can be published." : null,
  );
  const [selectedPageId, setSelectedPageId] = createSignal(props.initialDefinition.startPageId);
  const [selectedBlockId, setSelectedBlockId] = createSignal<string | null>(null);
  const [selectedActionId, setSelectedActionId] = createSignal<string | null>(null);
  const [previewResults, setPreviewResults] = createSignal<Record<string, DslQueryPreviewResponse>>(props.initialPreviewResults ?? {});
  const [inspectorOpen, setInspectorOpen] = createSignal(true);
  const [inspectorMode, setInspectorMode] = createSignal<"app" | "page" | "block" | "action">(props.initialInspectorMode ?? "page");
  const selectedPage = createMemo(() => draft.draft().pages.find((page) => page.id === selectedPageId()) ?? draft.draft().pages[0]!);
  const selectedBlock = createMemo<SelectedBlock | null>(() => {
    const blockId = selectedBlockId();
    if (!blockId) return null;
    for (const row of selectedPage().rows) {
      for (const column of row.columns) {
        const blockIndex = column.blocks.findIndex((block) => block.id === blockId);
        if (blockIndex >= 0) return { block: column.blocks[blockIndex]!, blockIndex, column, row };
      }
    }
    return null;
  });
  const selectedSourceBlock = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "records" || block?.type === "metrics" || block?.type === "chart" ? block : null;
  });
  const selectedRecordBlock = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "record" ? block : null;
  });
  const selectedRecordsBlock = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "records" ? block : null;
  });
  const selectedFormBlock = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "form" ? block : null;
  });
  const selectedChartBlock = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "chart" ? block : null;
  });
  const selectedActionsBlock = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "actions" ? block : null;
  });
  const selectedAction = createMemo<SelectedAction | null>(() => {
    const actionId = selectedActionId();
    if (!actionId) return null;
    const actions = selectedActionsBlock()?.actions ?? [];
    const index = actions.findIndex((action) => action.id === actionId);
    return index < 0 ? null : { action: actions[index]!, index };
  });
  const selectedNavigateAction = createMemo(() => {
    const action = selectedAction()?.action;
    return action?.kind === "navigate" ? action : null;
  });
  const selectedWorkflowAction = createMemo(() => {
    const action = selectedAction()?.action;
    return action?.kind === "workflow" ? action : null;
  });
  const contextKeys = createMemo(() => customAppContextKeys(selectedPage()));
  const blockCount = createMemo(() =>
    selectedPage().rows.reduce((total, row) => total + row.columns.reduce((sum, column) => sum + column.blocks.length, 0), 0),
  );
  const tablesById = createMemo(() => new Map(props.catalog.tables.map((table) => [table.id, table])));
  const tableOptions = createMemo(() =>
    props.catalog.tables.map((table) => ({ value: table.id, label: table.name, icon: table.icon ?? "ti ti-table" })),
  );
  const pageRecordTableOptions = createMemo(() =>
    tableOptions().map((option) => ({
      ...option,
      disabled: !(props.catalog.fieldsByTable[option.value] ?? []).some((field) => field.deletedAt === null),
    })),
  );
  const views = createMemo(() =>
    Object.values(props.catalog.viewsByTable)
      .flat()
      .filter((view) => view.deletedAt === null)
      .sort((left, right) => left.position - right.position),
  );
  const fieldsById = createMemo(
    () =>
      new Map(
        Object.values(props.catalog.fieldsByTable)
          .flat()
          .map((field) => [field.id, field]),
      ),
  );
  const viewResources = createMemo(() =>
    views().map((view) => ({ view, fields: fieldsForView(view, props.catalog.fieldsByTable, fieldsById()) })),
  );
  const viewsById = createMemo(() => new Map(views().map((view) => [view.id, view])));
  const viewOptions = createMemo(() =>
    viewResources().map(({ view, fields }) => ({
      value: view.id,
      label: view.name,
      description: tablesById().get(view.tableId)?.name ?? "Saved view",
      icon: view.icon ?? "ti ti-table",
      disabled: fields.length === 0,
    })),
  );
  const readyViews = createMemo(() => viewResources().filter((resource) => resource.fields.length > 0));
  const forms = createMemo(() =>
    Object.values(props.catalog.formsByTable)
      .flat()
      .filter((form) => form.deletedAt === null && form.isActive && isUuid(form.id))
      .sort((left, right) => left.position - right.position),
  );
  const formsById = createMemo(() => new Map(forms().map((form) => [form.id, form])));
  const workflowsById = createMemo(() => new Map(props.catalog.workflows.map((workflow) => [workflow.id, workflow])));
  const workflowLaunchers = createMemo(() =>
    props.catalog.workflowLaunchers.filter(
      (launcher): launcher is CustomAppWorkflowLauncher => launcher.config.kind === "customApp" && workflowsById().has(launcher.workflowId),
    ),
  );
  const workflowLauncherOptions = createMemo(() =>
    workflowLaunchers().map((launcher) => ({
      value: launcher.id,
      label: launcher.config.label || launcher.name,
      description: workflowsById().get(launcher.workflowId)?.name ?? "Workflow launcher",
      icon: "ti ti-player-play",
    })),
  );
  const formOptions = createMemo(() =>
    forms().map((form) => ({
      value: form.id,
      label: form.name,
      description: tablesById().get(form.tableId)?.name ?? "Active form",
      icon: "ti ti-forms",
    })),
  );
  const selectedRecordsView = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "records" && block.source.kind === "view" ? (viewsById().get(block.source.viewId) ?? null) : null;
  });
  const selectedRecordsFields = createMemo(() => {
    const block = selectedSourceBlock();
    if (block?.type !== "records") return [];
    if (block.source.kind === "view") {
      const view = selectedRecordsView();
      return view ? (viewResources().find((resource) => resource.view.id === view.id)?.fields ?? []) : [];
    }
    const preview = previewResults()[block.id];
    if (!preview?.ok) return [];
    return preview.columns
      .flatMap((column) => (column.fieldId ? [fieldsById().get(column.fieldId)] : []))
      .filter((field): field is Field => Boolean(field));
  });
  const selectedRecordsFieldOptions = createMemo(() =>
    selectedRecordsFields().map((field) => ({
      id: field.id,
      label: field.name,
      description: field.type,
      icon: field.icon ?? "ti ti-column-insert-right",
    })),
  );
  const selectedSourceTableId = createMemo(() => {
    const block = selectedSourceBlock();
    if (!block) return null;
    if (block.source.kind === "view") return viewsById().get(block.source.viewId)?.tableId ?? null;
    const preview = previewResults()[block.id];
    if (!preview?.ok) return null;
    return preview.columns.find((column) => column.tableId)?.tableId ?? preview.rows.find((row) => row.tableId)?.tableId ?? null;
  });
  const documentTemplateOptions = createMemo(() => {
    const tableId = selectedPage().record?.tableId;
    if (!tableId) return [];
    return (props.catalog.documentTemplatesByTable[tableId] ?? [])
      .filter((template) => template.enabled)
      .map((template) => ({
        id: template.id,
        label: template.name,
        description: template.description ?? undefined,
        icon: "ti ti-file-text",
      }));
  });
  const selectedForm = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "form" ? (formsById().get(block.formId) ?? null) : null;
  });
  const selectedFormBindingOptions = createMemo(() => {
    const form = selectedForm();
    if (!form) return [];
    const fields = new Map((props.catalog.fieldsByTable[form.tableId] ?? []).map((field) => [field.id, field]));
    return form.config.fields.flatMap((entry) => {
      if (entry.kind !== "user_input") return [];
      const field = fields.get(entry.fieldId);
      if (!field || field.type !== "relation" || field.deletedAt !== null) return [];
      const targetTableId = typeof field.config.targetTableId === "string" ? field.config.targetTableId : null;
      if (!targetTableId) return [];
      return [{ field, label: entry.label || field.name, targetTableId }];
    });
  });
  const diagnosticsForSelection = createMemo(() => {
    const selectedId = selectedBlockId();
    const pageId = selectedPage().id;
    return diagnostics().filter((diagnostic) => {
      if (selectedId && diagnostic.path.includes(selectedId)) return true;
      if (!selectedId && diagnostic.path.includes(pageId)) return true;
      return !diagnostic.path.includes("blocks") && !diagnostic.path.includes("pages");
    });
  });
  const panelDiagnostics = createMemo(() => {
    if (inspectorMode() === "page") {
      return diagnosticsForSelection().filter((diagnostic) => !isCustomAppAvailabilityDiagnostic(diagnostic, selectedPage().id));
    }
    const block = selectedSourceBlock();
    const selected = selectedBlock()?.block;
    if (!selected) return diagnosticsForSelection();
    if (inspectorMode() === "action") {
      const actionId = selectedActionId();
      return diagnosticsForSelection().filter(
        (diagnostic) => actionId && diagnostic.path.includes(actionId) && !isCustomAppAvailabilityDiagnostic(diagnostic, actionId),
      );
    }
    return diagnosticsForSelection().filter(
      (diagnostic) =>
        !isCustomAppAvailabilityDiagnostic(diagnostic, selected.id) &&
        !(block?.source.kind === "gql" && isCustomAppBlockSourceDiagnostic(diagnostic, block.id)),
    );
  });
  const diagnosticFor = (blockId: string, segment: string) =>
    diagnostics().find((diagnostic) => diagnostic.path.includes(blockId) && diagnostic.path.includes(segment))?.message;

  const selectPage = (pageId: string) => {
    setSelectedPageId(pageId);
    setSelectedBlockId(null);
    setSelectedActionId(null);
    setInspectorMode("page");
    setInspectorOpen(true);
  };

  const selectBlock = (blockId: string) => {
    setSelectedBlockId(blockId);
    setSelectedActionId(null);
    setInspectorMode("block");
    setInspectorOpen(true);
  };

  const selectAction = (actionId: string) => {
    setSelectedActionId(actionId);
    setInspectorMode("action");
    setInspectorOpen(true);
  };

  const setDefinition = (update: (current: CustomAppDefinition) => CustomAppDefinition) => {
    setDiagnostics([]);
    draft.set(update(draft.snapshot()));
  };

  const patchPage = (patch: Partial<CustomAppPage>, preserveDiagnostics = false) => {
    const pageId = selectedPage().id;
    const update = (definition: CustomAppDefinition): CustomAppDefinition => ({
      ...definition,
      pages: definition.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
    });
    if (preserveDiagnostics) draft.set(update(draft.snapshot()));
    else setDefinition(update);
  };

  const updateSelectedBlock = (update: (block: CustomAppBlock) => CustomAppBlock) => {
    const selected = selectedBlock();
    if (!selected) return;
    draft.updateBlock(selectedPage().id, selected.block.id, update);
  };

  const updateSelectedAction = (update: (action: CustomAppAction) => CustomAppAction) => {
    const actionId = selectedActionId();
    if (!actionId) return;
    updateSelectedBlock((block) =>
      block.type === "actions"
        ? { ...block, actions: block.actions.map((action) => (action.id === actionId ? update(action) : action)) }
        : block,
    );
  };

  const addBlock = (block: CustomAppBlock) => {
    const targetColumnId = selectedBlock()?.column.id ?? selectedPage().rows[0]!.columns[0]!.id;
    patchPage({
      rows: selectedPage().rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => (column.id === targetColumnId ? { ...column, blocks: [...column.blocks, block] } : column)),
      })),
    });
    selectBlock(block.id);
  };

  const addTextBlock = () => addBlock({ id: localId("markdown"), type: "markdown", markdown: "" });
  const addRecordsBlock = () => {
    const resource = readyViews()[0];
    if (!resource) return;
    addBlock({
      id: localId("records"),
      type: "records",
      source: { kind: "view", viewId: resource.view.id },
      display: { kind: "table", columnIds: resource.fields.map((field) => field.id) },
    });
  };
  const addFormBlock = () => {
    const form = forms()[0];
    if (!form) return;
    addBlock({ id: localId("form"), type: "form", formId: form.id, fixedValues: {} });
  };
  const addMetricsBlock = () => {
    const view = readyViews()[0]?.view;
    if (view) addBlock({ id: localId("metrics"), type: "metrics", source: { kind: "view", viewId: view.id } });
  };
  const addChartBlock = () => {
    const view = readyViews()[0]?.view;
    if (view) addBlock({ id: localId("chart"), type: "chart", chartType: "bar", limit: 100, source: { kind: "view", viewId: view.id } });
  };
  const pageRecordFields = createMemo(() => {
    const tableId = selectedPage().record?.tableId;
    return tableId ? (props.catalog.fieldsByTable[tableId] ?? []).filter((field) => field.deletedAt === null).slice(0, 30) : [];
  });
  const addRecordBlock = () => {
    const fields = pageRecordFields();
    if (fields.length > 0) {
      addBlock({ id: localId("record"), type: "record", fieldIds: fields.map((field) => field.id), editableFieldIds: [] });
    }
  };
  const addCommentsBlock = () => addBlock({ id: localId("comments"), type: "comments" });
  const addActionsBlock = () =>
    addBlock({
      id: localId("actions"),
      type: "actions",
      actions: [
        {
          id: localId("action"),
          label: "Open start page",
          kind: "navigate",
          pageId: draft.draft().startPageId,
          history: "push",
          params: {},
        },
      ],
    });
  const addBlockItems = createMemo(() => [
    { icon: "ti ti-markdown", label: "Markdown", description: "Add formatted text.", action: addTextBlock },
    readyViews().length > 0
      ? { icon: "ti ti-table", label: "Records", description: "Show records from a saved view.", action: addRecordsBlock }
      : { icon: "ti ti-table", label: "Records", description: "Create a saved view with visible fields first.", disabled: true as const },
    forms().length > 0
      ? { icon: "ti ti-forms", label: "Form", description: "Embed an active form.", action: addFormBlock }
      : { icon: "ti ti-forms", label: "Form", description: "Create and activate a form first.", disabled: true as const },
    readyViews().length > 0
      ? { icon: "ti ti-chart-dots", label: "Metrics", description: "Summarize an aggregate view or GQL query.", action: addMetricsBlock }
      : { icon: "ti ti-chart-dots", label: "Metrics", description: "Create a saved aggregate view first.", disabled: true as const },
    readyViews().length > 0
      ? { icon: "ti ti-chart-bar", label: "Chart", description: "Visualize an aggregate view or GQL query.", action: addChartBlock }
      : { icon: "ti ti-chart-bar", label: "Chart", description: "Create a saved aggregate view first.", disabled: true as const },
    selectedPage().record && pageRecordFields().length > 0
      ? { icon: "ti ti-id", label: "Record", description: "Show fields from the page record.", action: addRecordBlock }
      : { icon: "ti ti-id", label: "Record", description: "Configure a page record first.", disabled: true as const },
    selectedPage().record
      ? { icon: "ti ti-messages", label: "Comments", description: "Show comments for the page record.", action: addCommentsBlock }
      : { icon: "ti ti-messages", label: "Comments", description: "Configure a page record first.", disabled: true as const },
    { icon: "ti ti-bolt", label: "Actions", description: "Add page or workflow actions.", action: addActionsBlock },
  ]);

  const newLayoutIds = (): CustomAppLayoutIds => ({
    rowIds: [localId("row"), localId("row")],
    columnIds: [localId("column"), localId("column"), localId("column")],
  });
  const blockDnd = dnd.create<CustomAppBlockDragMeta, CustomAppBlockDropMeta, CustomAppBlockDropIntent>({
    collisionDetector: ({ droppables, pointer, previousOverId }) => selectCustomAppBlockDropTarget(droppables, pointer, previousOverId),
    buildIntent: ({ over }) => over?.meta.intent ?? null,
    isSameIntent: sameCustomAppBlockDropIntent,
    onDragStart: ({ active }) => selectBlock(active.meta.blockId),
    announcements: {
      dragStart: (active) => `Picked up ${active.meta.label} block.`,
      dragOver: (active, over) => (over ? `Move ${active.meta.label} ${over.meta.label}.` : `${active.meta.label} has no drop target.`),
      drop: (active, over) => (over ? `Moved ${active.meta.label} ${over.meta.label}.` : `${active.meta.label} was not moved.`),
      cancel: (active) => `Cancelled moving ${active.meta.label}.`,
    },
    onDrop: ({ active, over, intent }) => {
      if (!over || !intent) return;
      const next = applyCustomAppBlockDrop(selectedPage(), active.meta.blockId, intent, newLayoutIds());
      if (next === selectedPage()) return;
      patchPage({ rows: next.rows });
      selectBlock(active.meta.blockId);
    },
  });

  const moveSelectedBlock = (direction: -1 | 1) => {
    const selected = selectedBlock();
    if (!selected) return;
    const nextIndex = selected.blockIndex + direction;
    if (nextIndex < 0 || nextIndex >= selected.column.blocks.length) return;
    const target = selected.column.blocks[nextIndex]!;
    const next = applyCustomAppBlockDrop(
      selectedPage(),
      selected.block.id,
      { kind: "stack", targetBlockId: target.id, edge: direction < 0 ? "before" : "after" },
      newLayoutIds(),
    );
    if (next !== selectedPage()) patchPage({ rows: next.rows });
  };

  const removeSelectedBlock = async () => {
    const selected = selectedBlock();
    if (!selected || blockCount() === 1) return;
    const confirmed = await prompts.confirm(`Remove "${selected.block.title || blockMeta[selected.block.type].label}" from this page?`, {
      title: "Remove block",
      icon: "ti ti-trash",
      confirmText: "Remove",
      variant: "danger",
    });
    if (!confirmed) return;
    const page = normalizeCustomAppPageLayout({
      ...selectedPage(),
      rows: selectedPage().rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => ({
          ...column,
          blocks: column.blocks.filter((block) => block.id !== selected.block.id),
        })),
      })),
    });
    patchPage({ rows: page.rows });
    setSelectedBlockId(null);
  };

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueued = false;
  let activeSave: Promise<boolean> | null = null;
  const drainQueuedDrafts = async (): Promise<boolean> => {
    let successful = true;
    while (saveQueued) {
      saveQueued = false;
      const version = draft.version();
      const definition = draft.snapshot();
      setSaveState("saving");
      setSaveError(null);
      try {
        const response = await apiClient.apps[":appId"].draft.$put({ param: { appId: app().id }, json: { definition } });
        if (!response.ok) throw new Error(await errorMessage(response, "Could not save the Custom App draft."));
        const saved = (await response.json()) as CustomAppDraftSave;
        if (!saved.app.draftDefinition) {
          throw new Error(saved.app.draftDiagnostics[0]?.message ?? "The saved draft is not a valid schema v2 definition.");
        }
        setApp(saved.app);
        setDiagnostics(saved.diagnostics);
        draft.markSaved(saved.app.draftDefinition);
        setSaveState(saved.valid ? "saved" : "invalid");
        setSaveError(saved.valid ? null : "The draft was saved, but it must be fixed before it can be published.");
        if (draft.version() !== version) saveQueued = true;
      } catch (error) {
        setSaveState("error");
        setSaveError(error instanceof Error ? error.message : "Could not save the Custom App draft.");
        successful = false;
        break;
      }
    }
    return successful;
  };
  const persistQueuedDrafts = (): Promise<boolean> => {
    if (activeSave) return activeSave;
    activeSave = drainQueuedDrafts().finally(() => {
      activeSave = null;
    });
    return activeSave;
  };

  const queueAutosave = () => {
    saveQueued = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persistQueuedDrafts(), 650);
  };

  createEffect(() => {
    draft.version();
    if (draft.dirty()) queueAutosave();
  });
  onCleanup(() => saveTimer && clearTimeout(saveTimer));

  const flushAutosave = async () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    if (draft.dirty()) saveQueued = true;
    return persistQueuedDrafts();
  };

  const publishMutation = mutations.create<CustomApp, void>({
    mutation: async (_, { abortSignal }) => {
      if (!(await flushAutosave())) throw new Error("The latest changes could not be saved.");
      const response = await apiClient.apps[":appId"].publish.$post({ param: { appId: app().id } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not publish the Custom App."));
      return (await response.json()) as CustomApp;
    },
    onSuccess: (published) => {
      if (!published.draftDefinition) {
        prompts.error(published.draftDiagnostics[0]?.message ?? "The published draft is not a valid schema v2 definition.");
        return;
      }
      setApp(published);
      draft.markSaved(published.draftDefinition);
      prompts.success("Custom App published.");
    },
    onError: (error) => prompts.error(error.message),
  });

  const addPage = () => {
    const page = newPage(draft.draft());
    setDefinition((definition) => ({ ...definition, pages: [...definition.pages, page] }));
    selectPage(page.id);
  };

  const moveSelectedPage = (direction: -1 | 1) =>
    setDefinition((definition) => moveCustomAppPage(definition, selectedPage().id, direction));

  const nextParameterId = () => {
    const parameters = selectedPage().parameters;
    if (!parameters.record_id) return "record_id";
    let index = 2;
    while (parameters[`record_${index}`]) index += 1;
    return `record_${index}`;
  };

  const addPageParameter = () => {
    const table = props.catalog.tables[0];
    if (!table) return;
    const id = nextParameterId();
    patchPage({
      parameters: { ...selectedPage().parameters, [id]: { type: "record", tableId: table.id, required: true } },
      navigation: { ...selectedPage().navigation, visible: false },
    });
  };

  const renamePageParameter = (from: string, to: string) => {
    if (from === to || !/^[a-z][a-z0-9_]{0,79}$/.test(to) || selectedPage().parameters[to]) return;
    setDefinition((definition) => renameCustomAppPageParameter(definition, selectedPage().id, from, to));
  };

  const configurePageRecord = (tableId: string | null) => {
    if (!tableId) {
      patchPage({ record: undefined });
      return;
    }
    const parameterId = Object.keys(selectedPage().parameters)[0] ?? "record_id";
    const fields = (props.catalog.fieldsByTable[tableId] ?? []).filter((field) => field.deletedAt === null).slice(0, 30);
    const hasRecordBlock = selectedPage().rows.some((row) =>
      row.columns.some((column) => column.blocks.some((block) => block.type === "record")),
    );
    patchPage({
      parameters: { [parameterId]: { type: "record", tableId, required: true } },
      record: { tableId, id: { source: "PARAMS", path: parameterId } },
      navigation: { ...selectedPage().navigation, visible: false },
      rows: selectedPage().rows.map((row, rowIndex) => ({
        ...row,
        columns: row.columns.map((column, columnIndex) => ({
          ...column,
          blocks: [
            ...column.blocks.map((block) =>
              block.type === "record"
                ? { ...block, fieldIds: fields.map((field) => field.id), editableFieldIds: [], documents: undefined }
                : block,
            ),
            ...(!hasRecordBlock && rowIndex === 0 && columnIndex === 0
              ? [{ id: localId("record"), type: "record" as const, fieldIds: fields.map((field) => field.id), editableFieldIds: [] }]
              : []),
          ],
        })),
      })),
    });
  };

  const clearPageRecord = async () => {
    if (!selectedPage().record) return;
    const confirmed = await prompts.confirm(
      "Remove the page record? Record and Comments blocks on this page will also be removed. The route parameter remains available.",
      { title: "Remove page record", icon: "ti ti-unlink", confirmText: "Remove page record", variant: "danger" },
    );
    if (!confirmed) return;
    patchPage({
      record: undefined,
      rows: selectedPage().rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => {
          const blocks = column.blocks.filter((block) => block.type !== "record" && block.type !== "comments");
          return {
            ...column,
            blocks: blocks.length > 0 ? blocks : [{ id: localId("markdown"), type: "markdown" as const, markdown: "" }],
          };
        }),
      })),
    });
  };

  const addNavigateAction = () => {
    const page = draft.draft().pages.find((candidate) => Object.keys(candidate.parameters).length === 0) ?? draft.draft().pages[0]!;
    const action: CustomAppAction = {
      id: localId("action"),
      label: `Open ${page.title}`,
      kind: "navigate",
      pageId: page.id,
      history: "push",
      params: {},
    };
    updateSelectedBlock((block) => (block.type === "actions" ? { ...block, actions: [...block.actions, action] } : block));
    selectAction(action.id);
  };

  const defaultNavigationParams = (pageId: string): Extract<CustomAppAction, { kind: "navigate" }>["params"] => {
    const target = draft.draft().pages.find((page) => page.id === pageId);
    if (!target) return {};
    const params: Extract<CustomAppAction, { kind: "navigate" }>["params"] = {};
    for (const [parameterId, parameter] of Object.entries(target.parameters)) {
      if (selectedPage().record?.tableId === parameter.tableId) {
        params[parameterId] = { source: "RECORD", path: "id" };
        continue;
      }
      const sourceParameter = Object.entries(selectedPage().parameters).find(([, value]) => value.tableId === parameter.tableId)?.[0];
      if (sourceParameter) params[parameterId] = { source: "PARAMS", path: sourceParameter };
    }
    return params;
  };

  const defaultFormSuccessParams = (
    formId: string,
    pageId: string,
  ): NonNullable<Extract<CustomAppBlock, { type: "form" }>["onSuccessNavigate"]>["params"] => {
    const target = draft.draft().pages.find((page) => page.id === pageId);
    const form = formsById().get(formId);
    const params: NonNullable<Extract<CustomAppBlock, { type: "form" }>["onSuccessNavigate"]>["params"] = {};
    if (!target) return params;
    for (const [parameterId, parameter] of Object.entries(target.parameters)) {
      if (form?.tableId === parameter.tableId) {
        params[parameterId] = { source: "RESULT", path: "recordId" };
        continue;
      }
      const sourceParameter = Object.entries(selectedPage().parameters).find(
        ([, candidate]) => candidate.tableId === parameter.tableId,
      )?.[0];
      if (sourceParameter) params[parameterId] = { source: "PARAMS", path: sourceParameter };
    }
    return params;
  };

  const addWorkflowAction = () => {
    const launcher = workflowLaunchers()[0];
    if (!launcher) return;
    const action: CustomAppAction = {
      id: localId("action"),
      label: launcher.config.kind === "customApp" && launcher.config.label ? launcher.config.label : launcher.name,
      kind: "workflow",
      launcherId: launcher.id,
      inputs: {},
    };
    updateSelectedBlock((block) => (block.type === "actions" ? { ...block, actions: [...block.actions, action] } : block));
    selectAction(action.id);
  };

  const moveSelectedAction = (direction: -1 | 1) => {
    const selected = selectedAction();
    if (!selected) return;
    updateSelectedBlock((block) => {
      if (block.type !== "actions") return block;
      const target = selected.index + direction;
      if (target < 0 || target >= block.actions.length) return block;
      const actions = [...block.actions];
      [actions[selected.index], actions[target]] = [actions[target]!, actions[selected.index]!];
      return { ...block, actions };
    });
  };

  const removeSelectedAction = async () => {
    const selected = selectedAction();
    const block = selectedActionsBlock();
    if (!selected || !block || block.actions.length === 1) return;
    const confirmed = await prompts.confirm(`Remove "${selected.action.label}"?`, {
      title: "Remove action",
      icon: "ti ti-trash",
      confirmText: "Remove",
      variant: "danger",
    });
    if (!confirmed) return;
    updateSelectedBlock((candidate) =>
      candidate.type === "actions"
        ? { ...candidate, actions: candidate.actions.filter((action) => action.id !== selected.action.id) }
        : candidate,
    );
    setSelectedActionId(null);
    setInspectorMode("block");
  };

  const removePage = async () => {
    const definition = draft.draft();
    if (definition.pages.length === 1) return;
    const page = selectedPage();
    const confirmed = await prompts.confirm(`Remove "${page.title}" from this app?`, {
      title: "Remove page",
      icon: "ti ti-trash",
      confirmText: "Remove",
      variant: "danger",
    });
    if (!confirmed) return;
    const pages = definition.pages.filter((candidate) => candidate.id !== page.id);
    const nextPage = pages[0]!;
    setDefinition((current) => ({
      ...current,
      pages,
      startPageId: current.startPageId === page.id ? nextPage.id : current.startPageId,
    }));
    selectPage(nextPage.id);
  };

  const restoreMutation = mutations.create<CustomApp, void>({
    mutation: async (_, { abortSignal }) => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = undefined;
      if (activeSave) await activeSave;
      saveQueued = false;
      const response = await apiClient.apps[":appId"].restore.$post({ param: { appId: app().id } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not restore the live version."));
      return (await response.json()) as CustomApp;
    },
    onSuccess: (restored) => {
      if (!restored.draftDefinition) {
        prompts.error(restored.draftDiagnostics[0]?.message ?? "The live version is not a valid schema v2 definition.");
        return;
      }
      saveQueued = false;
      setApp(restored);
      draft.replace(restored.draftDefinition);
      setDiagnostics([]);
      setSaveError(null);
      setSaveState("saved");
      selectPage(restored.draftDefinition.startPageId);
      prompts.success("Draft restored to the live version.");
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <>
      <AppWorkspace.Main class="p-0" mobilePane="main">
        <AppWorkspace.MainPane
          id="custom-app-pages"
          label="App pages"
          surface="navigation"
          defaultSize={280}
          minSize={220}
          maxSize={420}
          class="flex min-h-0 flex-col"
        >
          <Toolbar label="App pages" class="p-2" wrap>
            <Toolbar.Group>
              <strong class="px-1 text-sm">Pages</strong>
            </Toolbar.Group>
            <Toolbar.Spacer />
            <Show when={app().publishedAt}>
              <Toolbar.Group>
                <ButtonLink href={`/apps/${app().shortId}`} target="_blank" rel="noreferrer" size="xs" aria-label="Open live app">
                  <i class="ti ti-external-link" aria-hidden="true" />
                </ButtonLink>
              </Toolbar.Group>
            </Show>
          </Toolbar>
          <AppWorkspace.SidebarBody class="p-2" scrollPreserveKey={`grids-custom-app-pages-${props.app.id}`}>
            <AppWorkspace.SidebarSection>
              <For each={[...draft.draft().pages].sort((left, right) => left.navigation.order - right.navigation.order)}>
                {(page) => (
                  <AppWorkspace.SidebarItem active={selectedPage().id === page.id} onClick={() => selectPage(page.id)}>
                    <AppWorkspace.SidebarItemIcon icon={page.navigation.visible ? "ti ti-file" : "ti ti-file-off"} />
                    <AppWorkspace.SidebarItemLabel>{page.title}</AppWorkspace.SidebarItemLabel>
                    {draft.draft().startPageId === page.id && (
                      <AppWorkspace.SidebarItemMeta>
                        <span class="text-[9px] uppercase tracking-wider text-dimmed">start</span>
                      </AppWorkspace.SidebarItemMeta>
                    )}
                    <AppWorkspace.SidebarItemAction
                      icon="ti ti-settings"
                      label={`Settings for ${page.title}`}
                      onSelect={() => selectPage(page.id)}
                    />
                  </AppWorkspace.SidebarItem>
                )}
              </For>
              <AppWorkspace.SidebarItem tone="success" onClick={addPage} disabled={draft.draft().pages.length >= 12}>
                <AppWorkspace.SidebarItemIcon icon="ti ti-plus" />
                <AppWorkspace.SidebarItemLabel>New page</AppWorkspace.SidebarItemLabel>
              </AppWorkspace.SidebarItem>
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarBody>
          <Show
            when={
              !app().publishedAt || app().hasUnpublishedChanges || draft.dirty() || saveState() === "error" || saveState() === "invalid"
            }
          >
            <AppWorkspace.SidebarFooter class="p-2">
              <NoticeCard
                tone={saveState() === "error" || saveState() === "invalid" ? "danger" : "warning"}
                title={app().publishedAt ? "Changes are in a draft" : "This app is a draft"}
                detail={
                  saveState() === "saving"
                    ? "Saving changes automatically…"
                    : (saveError() ?? "Changes are saved automatically. Publish the draft when it is ready for everyone.")
                }
              >
                <div class="flex flex-wrap gap-2">
                  <Show when={app().publishedAt}>
                    <Button
                      size="xs"
                      variant="secondary"
                      loading={restoreMutation.loading()}
                      disabled={publishMutation.loading()}
                      onClick={() => restoreMutation.mutate(undefined)}
                    >
                      Restore live version
                    </Button>
                  </Show>
                  <Button
                    size="xs"
                    loading={publishMutation.loading()}
                    disabled={restoreMutation.loading() || saveState() === "invalid" || saveState() === "error"}
                    onClick={() => publishMutation.mutate(undefined)}
                  >
                    Publish changes
                  </Button>
                </div>
              </NoticeCard>
            </AppWorkspace.SidebarFooter>
          </Show>
        </AppWorkspace.MainPane>

        <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-base" aria-label="Custom App canvas">
          <Toolbar label="Custom App builder" class="p-2" wrap>
            <Toolbar.Group class="min-w-0">
              <div class="flex min-w-0 items-center gap-2 px-1">
                <i class={draft.draft().icon ? `ti ti-${draft.draft().icon}` : "ti ti-app-window"} aria-hidden="true" />
                <strong class="truncate text-sm">{draft.draft().name}</strong>
                <StatusBadge tone={app().publishedAt ? "ok" : "neutral"} variant="text" label={app().publishedAt ? "Published" : "Draft"} />
              </div>
            </Toolbar.Group>
            <Toolbar.Spacer />
            <Toolbar.Group>
              <Dropdown.Root items={addBlockItems()} position="bottom-right" width="16rem" label="Add content block">
                <Dropdown.Trigger size="xs" variant="secondary">
                  <i class="ti ti-plus" aria-hidden="true" /> Add block
                </Dropdown.Trigger>
              </Dropdown.Root>
            </Toolbar.Group>
          </Toolbar>

          <div class="min-h-0 flex-1 overflow-auto bg-[var(--ui-surface)]">
            <CustomAppPageLayout
              definition={draft.draft()}
              page={selectedPage()}
              shortId={app().shortId}
              editor={{
                selectedBlockId,
                onSelectBlock: selectBlock,
                onSelectPage: selectPage,
                dnd: blockDnd,
              }}
              renderBlock={(block) => (
                <CustomAppBlockPreview
                  block={block}
                  baseId={draft.draft().baseId}
                  shortId={app().shortId}
                  catalog={props.catalog}
                  dateConfig={props.dateConfig}
                  initialResult={props.initialPreviewResults?.[block.id]}
                  onPreviewResult={(blockId, result) => setPreviewResults((current) => ({ ...current, [blockId]: result }))}
                />
              )}
            />
          </div>
        </section>
      </AppWorkspace.Main>

      <AppWorkspace.Detail id="custom-app-inspector" open={inspectorOpen()} width="md" resizable minWidth={280} maxWidth={520}>
        <DetailPanel>
          <DetailPanel.Header
            icon={
              inspectorMode() === "action"
                ? selectedAction()?.action.kind === "workflow"
                  ? "ti ti-player-play"
                  : "ti ti-link"
                : inspectorMode() === "block"
                  ? blockMeta[selectedBlock()?.block.type ?? "markdown"].icon
                  : inspectorMode() === "app"
                    ? "ti ti-app-window"
                    : "ti ti-file-settings"
            }
            title={
              inspectorMode() === "action"
                ? (selectedAction()?.action.label ?? "Action")
                : inspectorMode() === "block"
                  ? selectedBlock()?.block.title || blockMeta[selectedBlock()?.block.type ?? "markdown"].label
                  : inspectorMode() === "app"
                    ? "App settings"
                    : selectedPage().title
            }
            subtitle={
              inspectorMode() === "action"
                ? "Action settings"
                : inspectorMode() === "block"
                  ? "Content block"
                  : inspectorMode() === "app"
                    ? draft.draft().name
                    : "Page settings"
            }
            actions={
              <IconButton size="sm" label="Close inspector" onClick={() => setInspectorOpen(false)}>
                <i class="ti ti-x" aria-hidden="true" />
              </IconButton>
            }
          />
          <DetailPanel.Body
            scrollPreserveKey={`grids-custom-app-inspector-${app().id}-${inspectorMode()}-${selectedActionId() ?? selectedBlockId() ?? selectedPage().id}`}
          >
            <Show when={panelDiagnostics().length > 0}>
              <NoticeCard tone="danger" icon={false} role="alert">
                <p class="font-medium">This draft needs attention</p>
                <ul class="mt-2 list-disc space-y-1 pl-4 text-sm">
                  <For each={panelDiagnostics()}>{(diagnostic) => <li>{diagnostic.message}</li>}</For>
                </ul>
              </NoticeCard>
            </Show>
            <Show when={inspectorMode() === "app"}>
              <DetailPanel.Group label="App settings">
                <DetailPanel.Section title="Identity" icon="ti ti-app-window" tone="accent">
                  <div class="flex flex-col gap-3">
                    <TextInput
                      label="Name"
                      value={() => draft.draft().name}
                      onValueChange={(name) => setDefinition((definition) => ({ ...definition, name }))}
                      required
                    />
                    <IconInput
                      label="Icon"
                      value={() => iconInputValue(draft.draft().icon)}
                      onValueChange={(value) => setDefinition((definition) => ({ ...definition, icon: iconSlug(value) }))}
                      clearable
                    />
                  </div>
                </DetailPanel.Section>
                <DetailPanel.Section
                  title="Access"
                  icon="ti ti-shield"
                  description="Who can open the published app. This is separate from availability rules."
                  collapsible
                  defaultOpen={false}
                >
                  <div class="flex flex-col gap-3">
                    <p class="text-xs text-dimmed">
                      Custom App grants are independent from Base access. Public allows anonymous visitors to open the published app.
                    </p>
                    <ScopedPermissionEditor scope={{ type: "customApp", id: app().id }} canEdit />
                  </div>
                </DetailPanel.Section>
              </DetailPanel.Group>
            </Show>

            <Show when={inspectorMode() === "page"}>
              <DetailPanel.Group label="Page settings">
                <DetailPanel.Section title="Page" icon="ti ti-file-settings" tone="accent">
                  <div class="flex flex-col gap-3">
                    <TextInput label="Title" value={() => selectedPage().title} onValueChange={(title) => patchPage({ title })} required />
                    <Switch
                      label="Show in app navigation"
                      description={
                        Object.keys(selectedPage().parameters).length > 0
                          ? "Pages with required parameters are route-only and cannot appear in navigation."
                          : undefined
                      }
                      value={() => selectedPage().navigation.visible}
                      onValueChange={(visible) => patchPage({ navigation: { ...selectedPage().navigation, visible } })}
                      disabled={Object.keys(selectedPage().parameters).length > 0}
                    />
                    <Show
                      when={draft.draft().startPageId === selectedPage().id}
                      fallback={
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={Object.keys(selectedPage().parameters).length > 0}
                          onClick={() => setDefinition((definition) => ({ ...definition, startPageId: selectedPage().id }))}
                        >
                          Set as start page
                        </Button>
                      }
                    >
                      <StatusBadge tone="ok" label="Start page" variant="text" />
                    </Show>
                    <div>
                      <p class="text-xs text-dimmed">Page ID</p>
                      <code class="text-xs">{selectedPage().id}</code>
                    </div>
                  </div>
                </DetailPanel.Section>
                <CustomAppAvailabilitySection
                  baseId={draft.draft().baseId}
                  contextKeys={contextKeys()}
                  targetLabel={selectedPage().title}
                  value={() => selectedPage().availableWhen?.query ?? ""}
                  onValueChange={(query) => patchPage({ availableWhen: query.trim() ? { query } : undefined }, true)}
                  error={() => diagnosticFor(selectedPage().id, "availableWhen")}
                />
                <DetailPanel.Section
                  title="Route parameters"
                  icon="ti ti-route"
                  description="Required record IDs supplied by links, rows, Forms, or actions."
                  meta={<StatusBadge tone="neutral" variant="text" label={`${Object.keys(selectedPage().parameters).length}`} />}
                  collapsible
                  defaultOpen={Object.keys(selectedPage().parameters).length > 0}
                >
                  <div class="flex flex-col gap-4">
                    <For each={Object.entries(selectedPage().parameters)}>
                      {([parameterId, parameter]) => {
                        const usage = () => customAppPageParameterUsage(draft.draft(), selectedPage().id, parameterId);
                        return (
                          <div class="flex flex-col gap-3">
                            <PageParameterIdInput
                              id={parameterId}
                              existingIds={Object.keys(selectedPage().parameters)}
                              onRename={(next) => renamePageParameter(parameterId, next)}
                            />
                            <Select
                              label="Record table"
                              searchable
                              disabled={selectedPage().record?.id.path === parameterId}
                              description={
                                selectedPage().record?.id.path === parameterId
                                  ? "Change this table from the Page record section."
                                  : undefined
                              }
                              value={() => parameter.tableId}
                              options={tableOptions()}
                              onValueChange={(tableId) =>
                                tableId &&
                                patchPage({
                                  parameters: {
                                    ...selectedPage().parameters,
                                    [parameterId]: { type: "record", tableId, required: true },
                                  },
                                })
                              }
                            />
                            <Button
                              size="xs"
                              variant="ghost"
                              class="self-start"
                              disabled={usage().length > 0}
                              title={usage().length > 0 ? `Used by ${usage().join(", ")}` : undefined}
                              onClick={() =>
                                setDefinition((definition) => removeCustomAppPageParameter(definition, selectedPage().id, parameterId))
                              }
                            >
                              <i class="ti ti-x" aria-hidden="true" /> Remove parameter
                            </Button>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={Object.keys(selectedPage().parameters).length === 0}>
                      <p class="text-sm text-dimmed">This page has no required route values.</p>
                    </Show>
                    <Button size="sm" variant="secondary" onClick={addPageParameter} disabled={props.catalog.tables.length === 0}>
                      <i class="ti ti-plus" aria-hidden="true" /> Add record parameter
                    </Button>
                  </div>
                </DetailPanel.Section>
                <DetailPanel.Section
                  title="Page record"
                  icon="ti ti-id"
                  description="Lets Record and Comments blocks use one route record."
                  collapsible
                  defaultOpen={Boolean(selectedPage().record)}
                >
                  <div class="flex flex-col gap-3">
                    <Select
                      label="Record table"
                      placeholder="No page record"
                      value={() => selectedPage().record?.tableId ?? null}
                      options={pageRecordTableOptions()}
                      onValueChange={(tableId) => tableId && configurePageRecord(tableId)}
                    />
                    <Show when={selectedPage().record}>
                      <Button size="xs" variant="ghost" class="self-start" onClick={() => void clearPageRecord()}>
                        <i class="ti ti-unlink" aria-hidden="true" /> Remove page record
                      </Button>
                    </Show>
                  </div>
                </DetailPanel.Section>
                <DetailPanel.Section title="Page order" icon="ti ti-arrows-sort" collapsible defaultOpen={false}>
                  <div class="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        [...draft.draft().pages].sort((a, b) => a.navigation.order - b.navigation.order)[0]?.id === selectedPage().id
                      }
                      onClick={() => moveSelectedPage(-1)}
                    >
                      <i class="ti ti-arrow-up" aria-hidden="true" /> Move up
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        [...draft.draft().pages].sort((a, b) => a.navigation.order - b.navigation.order).at(-1)?.id === selectedPage().id
                      }
                      onClick={() => moveSelectedPage(1)}
                    >
                      <i class="ti ti-arrow-down" aria-hidden="true" /> Move down
                    </Button>
                  </div>
                </DetailPanel.Section>
                <DetailPanel.Section title="Danger zone" icon="ti ti-trash" tone="danger" collapsible defaultOpen={false}>
                  <Button size="sm" variant="danger" disabled={draft.draft().pages.length === 1} onClick={() => void removePage()}>
                    <i class="ti ti-trash" aria-hidden="true" /> Remove page
                  </Button>
                </DetailPanel.Section>
              </DetailPanel.Group>
            </Show>

            <Show when={inspectorMode() === "block" && selectedBlock()}>
              {(selected) => (
                <DetailPanel.Group label="Block settings">
                  <DetailPanel.Section title="General" icon={blockMeta[selected().block.type].icon} tone="accent">
                    <div class="flex flex-col gap-4">
                      <TextInput
                        label="Title"
                        value={() => selected().block.title ?? ""}
                        onValueChange={(title) =>
                          updateSelectedBlock((block) => ({ ...block, title: title || undefined }) as CustomAppBlock)
                        }
                        clearable
                      />
                      <Show when={selected().block.type === "markdown"}>
                        <TextInput
                          label="Content"
                          description="Markdown is sanitized when the published app renders it."
                          value={() => {
                            const block = selected().block;
                            return block.type === "markdown" ? block.markdown : "";
                          }}
                          onValueChange={(markdown) =>
                            updateSelectedBlock((block) => (block.type === "markdown" ? { ...block, markdown } : block))
                          }
                          markdown
                        />
                      </Show>
                    </div>
                  </DetailPanel.Section>
                  <CustomAppAvailabilitySection
                    baseId={draft.draft().baseId}
                    contextKeys={contextKeys()}
                    targetLabel={selected().block.title || blockMeta[selected().block.type].label}
                    value={() => selected().block.availableWhen?.query ?? ""}
                    onValueChange={(query) =>
                      updateSelectedBlock((block) => ({ ...block, availableWhen: query.trim() ? { query } : undefined }) as CustomAppBlock)
                    }
                    error={() => diagnosticFor(selected().block.id, "availableWhen")}
                  />
                  <DetailPanel.Section title="Block settings" icon="ti ti-adjustments" collapsible defaultOpen>
                    <div class="flex flex-col gap-4">
                      <Show
                        when={
                          selected().block.type === "records" || selected().block.type === "metrics" || selected().block.type === "chart"
                        }
                      >
                        <Select
                          label="Data source"
                          value={() => {
                            const block = selected().block;
                            return block.type === "records" || block.type === "metrics" || block.type === "chart"
                              ? block.source.kind
                              : null;
                          }}
                          options={[
                            { id: "view", label: "Saved view", icon: "ti ti-table" },
                            { id: "gql", label: "GQL query", icon: "ti ti-code" },
                          ]}
                          onValueChange={(kind) => {
                            if (kind !== "view" && kind !== "gql") return;
                            const resource = readyViews()[0];
                            const tableName = props.catalog.tables[0]?.name ?? "Table";
                            updateSelectedBlock((block) => {
                              if (block.type !== "records" && block.type !== "metrics" && block.type !== "chart") return block;
                              if (kind === "gql") {
                                const query =
                                  block.type === "metrics"
                                    ? `from table "${tableName}"\naggregate count(*) as total`
                                    : `from table "${tableName}"`;
                                return { ...block, source: { kind: "gql", query, maxRows: block.type === "metrics" ? 1 : 100 } };
                              }
                              if (!resource) return block;
                              return block.type === "records"
                                ? {
                                    ...block,
                                    source: { kind: "view", viewId: resource.view.id },
                                    display: { kind: "table", columnIds: resource.fields.map((field) => field.id) },
                                  }
                                : { ...block, source: { kind: "view", viewId: resource.view.id } };
                            });
                          }}
                        />
                        <Show when={selectedSourceBlock()?.source.kind === "gql"}>
                          <CustomAppGqlField
                            baseId={draft.draft().baseId}
                            contextKeys={contextKeys()}
                            label="GQL"
                            dialogTitle={`${selected().block.title || blockMeta[selected().block.type].label} data source`}
                            description="Use implicit @auth, @params, @page, @app, @base, and @time context."
                            error={() => {
                              const block = selected().block;
                              return block.type === "records" || block.type === "metrics" || block.type === "chart"
                                ? diagnosticFor(block.id, "source")
                                : undefined;
                            }}
                            lines={10}
                            value={() => {
                              const block = selected().block;
                              return (block.type === "records" || block.type === "metrics" || block.type === "chart") &&
                                block.source.kind === "gql"
                                ? block.source.query
                                : "";
                            }}
                            onValueChange={(query) =>
                              updateSelectedBlock((block) =>
                                (block.type === "records" || block.type === "metrics" || block.type === "chart") &&
                                block.source.kind === "gql"
                                  ? { ...block, source: { ...block.source, query } }
                                  : block,
                              )
                            }
                          />
                          <NumberInput
                            label="Maximum rows"
                            min={1}
                            max={100}
                            step={1}
                            value={() => {
                              const block = selected().block;
                              return (block.type === "records" || block.type === "metrics" || block.type === "chart") &&
                                block.source.kind === "gql"
                                ? block.source.maxRows
                                : null;
                            }}
                            onValueChange={(maxRows) => {
                              if (maxRows === null) return;
                              updateSelectedBlock((block) =>
                                (block.type === "records" || block.type === "metrics" || block.type === "chart") &&
                                block.source.kind === "gql"
                                  ? { ...block, source: { ...block.source, maxRows } }
                                  : block,
                              );
                            }}
                          />
                        </Show>
                      </Show>
                      <Show
                        when={
                          (selectedSourceBlock()?.type === "metrics" || selectedSourceBlock()?.type === "chart") &&
                          selectedSourceBlock()?.source.kind === "view"
                        }
                      >
                        <Select
                          label="Saved view"
                          searchable
                          value={() => {
                            const block = selected().block;
                            return (block.type === "metrics" || block.type === "chart") && block.source.kind === "view"
                              ? block.source.viewId
                              : null;
                          }}
                          options={viewOptions()}
                          onValueChange={(viewId) =>
                            viewId &&
                            updateSelectedBlock((block) =>
                              block.type === "metrics" || block.type === "chart" ? { ...block, source: { kind: "view", viewId } } : block,
                            )
                          }
                        />
                      </Show>
                      <Show when={selected().block.type === "records"}>
                        <Show when={selectedSourceBlock()?.type === "records" && selectedSourceBlock()?.source.kind === "view"}>
                          <Select
                            label="Saved view"
                            description="Only views you can use in this Base are listed."
                            placeholder="Choose a saved view"
                            searchable
                            value={() => {
                              const block = selected().block;
                              return block.type === "records" && block.source.kind === "view" ? block.source.viewId : null;
                            }}
                            selectedLabel={() => {
                              const block = selected().block;
                              if (block.type !== "records" || block.source.kind !== "view") return undefined;
                              return viewsById().has(block.source.viewId) ? undefined : "Unavailable view";
                            }}
                            error={() => {
                              const block = selected().block;
                              if (block.type !== "records") return undefined;
                              if (block.source.kind !== "view") return "Choose a saved view to configure this block visually.";
                              if (!viewsById().has(block.source.viewId)) return "This saved view is no longer available.";
                              return diagnosticFor(block.id, "source");
                            }}
                            options={viewOptions()}
                            onValueChange={(viewId) => {
                              if (!viewId) return;
                              const view = viewsById().get(viewId);
                              if (!view) return;
                              const fields = viewResources().find((resource) => resource.view.id === viewId)?.fields ?? [];
                              updateSelectedBlock((block) =>
                                block.type === "records"
                                  ? {
                                      ...block,
                                      source: { kind: "view", viewId },
                                      display: {
                                        kind: "table",
                                        columnIds: fields.map((field) => field.id),
                                      },
                                    }
                                  : block,
                              );
                            }}
                          />
                          <Show when={selectedRecordsView()}>
                            <MultiSelectInput
                              label="Columns"
                              description="Choose up to 30 fields shown by the Records table."
                              placeholder="Choose columns"
                              searchable
                              clearable
                              value={() => {
                                const block = selected().block;
                                return block.type === "records" ? block.display.columnIds : [];
                              }}
                              selectedOptions={() => {
                                const block = selected().block;
                                if (block.type !== "records") return [];
                                const options = new Map(selectedRecordsFieldOptions().map((option) => [option.id, option]));
                                return block.display.columnIds.map(
                                  (fieldId) => options.get(fieldId) ?? { id: fieldId, label: "Unavailable field" },
                                );
                              }}
                              options={selectedRecordsFieldOptions()}
                              error={() => {
                                const block = selected().block;
                                if (block.type !== "records") return undefined;
                                if (block.display.columnIds.length === 0) return "Choose at least one column.";
                                const available = new Set(selectedRecordsFields().map((field) => field.id));
                                if (block.display.columnIds.some((fieldId) => !available.has(fieldId))) {
                                  return "Replace or remove unavailable fields.";
                                }
                                return diagnosticFor(block.id, "columnIds");
                              }}
                              onValueChange={(columnIds) =>
                                updateSelectedBlock((block) =>
                                  block.type === "records"
                                    ? { ...block, display: { kind: "table", columnIds: columnIds.slice(0, 30) } }
                                    : block,
                                )
                              }
                            />
                          </Show>
                        </Show>
                        <Show when={selectedSourceBlock()?.type === "records" && selectedSourceBlock()?.source.kind === "gql"}>
                          <MultiSelectInput
                            label="Columns"
                            description="Resolved fields appear after the GQL preview succeeds."
                            placeholder="Choose query fields"
                            searchable
                            clearable
                            value={() => selectedRecordsBlock()?.display.columnIds ?? []}
                            selectedOptions={() => {
                              const block = selected().block;
                              if (block.type !== "records") return [];
                              const options = new Map(selectedRecordsFieldOptions().map((option) => [option.id, option]));
                              return block.display.columnIds.map(
                                (fieldId) => options.get(fieldId) ?? { id: fieldId, label: "Unavailable query field" },
                              );
                            }}
                            options={selectedRecordsFieldOptions()}
                            error={() => {
                              const block = selected().block;
                              if (block.type !== "records") return undefined;
                              if (block.display.columnIds.length === 0) return "Choose at least one resolved field.";
                              return diagnosticFor(block.id, "columnIds");
                            }}
                            onValueChange={(columnIds) =>
                              updateSelectedBlock((block) =>
                                block.type === "records"
                                  ? { ...block, display: { kind: "table", columnIds: columnIds.slice(0, 30) } }
                                  : block,
                              )
                            }
                          />
                        </Show>
                        <Select
                          label="Open row on page"
                          description="Optional. Compatible route pages receive the selected row ID."
                          placeholder="Do nothing"
                          clearable
                          value={() => selectedRecordsBlock()?.rowNavigate?.pageId ?? null}
                          options={draft
                            .draft()
                            .pages.filter((page) => {
                              const parameters = Object.values(page.parameters);
                              return (
                                parameters.length > 0 &&
                                Boolean(selectedSourceTableId()) &&
                                parameters.every((parameter) => parameter.tableId === selectedSourceTableId())
                              );
                            })
                            .map((page) => ({ id: page.id, label: page.title }))}
                          onValueChange={(pageId) =>
                            updateSelectedBlock((block) => {
                              if (block.type !== "records") return block;
                              if (!pageId) return { ...block, rowNavigate: undefined };
                              const target = draft.draft().pages.find((page) => page.id === pageId);
                              if (!target) return block;
                              return {
                                ...block,
                                rowNavigate: {
                                  kind: "navigate",
                                  pageId,
                                  history: "push",
                                  params: Object.fromEntries(
                                    Object.keys(target.parameters).map((parameterId) => [
                                      parameterId,
                                      { source: "ROW" as const, path: "id" as const },
                                    ]),
                                  ),
                                },
                              };
                            })
                          }
                        />
                        <Show when={selectedRecordsBlock()?.rowNavigate}>
                          <Select
                            label="Navigation history"
                            value={() => selectedRecordsBlock()?.rowNavigate?.history ?? "push"}
                            options={[
                              { id: "push", label: "Add to history" },
                              { id: "replace", label: "Replace current page" },
                            ]}
                            onValueChange={(history) =>
                              (history === "push" || history === "replace") &&
                              updateSelectedBlock((block) =>
                                block.type === "records" && block.rowNavigate
                                  ? { ...block, rowNavigate: { ...block.rowNavigate, history } }
                                  : block,
                              )
                            }
                          />
                        </Show>
                      </Show>
                      <Show when={selected().block.type === "form"}>
                        <Select
                          label="Form"
                          description="Only active forms you can use in this Base are listed."
                          placeholder="Choose an active form"
                          searchable
                          value={() => {
                            const block = selected().block;
                            return block.type === "form" ? block.formId : null;
                          }}
                          selectedLabel={() => {
                            const block = selected().block;
                            return block.type === "form" && !formsById().has(block.formId) ? "Unavailable form" : undefined;
                          }}
                          error={() => {
                            const block = selected().block;
                            if (block.type !== "form") return undefined;
                            if (!formsById().has(block.formId)) return "This form is missing or inactive.";
                            return diagnosticFor(block.id, "formId");
                          }}
                          options={formOptions()}
                          onValueChange={(formId) => {
                            if (!formId) return;
                            updateSelectedBlock((block) =>
                              block.type === "form" ? { ...block, formId, fixedValues: {}, onSuccessNavigate: undefined } : block,
                            );
                          }}
                        />
                        <Show when={selectedForm()}>
                          <Disclosure
                            summary="Prefilled relations"
                            icon="ti ti-link"
                            defaultValue={Object.keys(selectedFormBlock()?.fixedValues ?? {}).length > 0}
                          >
                            <div class="flex flex-col gap-3">
                              <p class="text-xs text-dimmed">Hide a Form relation input and fill it from a matching page parameter.</p>
                              <For each={selectedFormBindingOptions()}>
                                {(binding) => (
                                  <Select
                                    label={binding.label}
                                    placeholder="Ask in Form"
                                    clearable
                                    value={() => selectedFormBlock()?.fixedValues[binding.field.id]?.path ?? null}
                                    options={Object.entries(selectedPage().parameters)
                                      .filter(([, parameter]) => parameter.tableId === binding.targetTableId)
                                      .map(([parameterId]) => ({ id: parameterId, label: `@params.${parameterId}` }))}
                                    onValueChange={(parameterId) =>
                                      updateSelectedBlock((block) => {
                                        if (block.type !== "form") return block;
                                        const fixedValues = { ...block.fixedValues };
                                        if (parameterId) fixedValues[binding.field.id] = { source: "PARAMS", path: parameterId };
                                        else delete fixedValues[binding.field.id];
                                        return { ...block, fixedValues };
                                      })
                                    }
                                  />
                                )}
                              </For>
                              <Show when={selectedFormBindingOptions().length === 0}>
                                <p class="text-sm text-dimmed">This Form has no relation inputs that can be prefilled.</p>
                              </Show>
                            </div>
                          </Disclosure>
                          <Disclosure
                            summary="After submit"
                            icon="ti ti-arrow-forward-up"
                            defaultValue={Boolean(selectedFormBlock()?.onSuccessNavigate)}
                          >
                            <div class="flex flex-col gap-3">
                              <p class="text-xs text-dimmed">Optionally navigate after the Form creates its record.</p>
                              <Select
                                label="Target page"
                                placeholder="Stay on this page"
                                clearable
                                value={() => selectedFormBlock()?.onSuccessNavigate?.pageId ?? null}
                                options={draft.draft().pages.map((page) => ({ id: page.id, label: page.title }))}
                                onValueChange={(pageId) =>
                                  updateSelectedBlock((block) => {
                                    if (block.type !== "form") return block;
                                    if (!pageId) return { ...block, onSuccessNavigate: undefined };
                                    const target = draft.draft().pages.find((page) => page.id === pageId);
                                    if (!target) return block;
                                    return {
                                      ...block,
                                      onSuccessNavigate: {
                                        kind: "navigate",
                                        pageId,
                                        params: defaultFormSuccessParams(block.formId, pageId),
                                      },
                                    };
                                  })
                                }
                              />
                              <Show when={selectedFormBlock()?.onSuccessNavigate}>
                                {(navigation) => {
                                  const target = () => draft.draft().pages.find((page) => page.id === navigation().pageId);
                                  return (
                                    <For each={Object.entries(target()?.parameters ?? {})}>
                                      {([parameterId, parameter]) => {
                                        const current = () => navigation().params[parameterId];
                                        const options = () => [
                                          ...(selectedForm()?.tableId === parameter.tableId
                                            ? [{ id: "RESULT", label: "Created Form record" }]
                                            : []),
                                          ...Object.entries(selectedPage().parameters)
                                            .filter(([, candidate]) => candidate.tableId === parameter.tableId)
                                            .map(([sourceId]) => ({ id: `PARAMS:${sourceId}`, label: `@params.${sourceId}` })),
                                        ];
                                        return (
                                          <Select
                                            label={`Value for ${parameterId}`}
                                            value={() => {
                                              const value = current();
                                              return value?.source === "RESULT" ? "RESULT" : value ? `PARAMS:${value.path}` : null;
                                            }}
                                            options={options()}
                                            error={() => (current() ? undefined : "Choose a compatible value.")}
                                            onValueChange={(value) =>
                                              value &&
                                              updateSelectedBlock((block) => {
                                                if (block.type !== "form" || !block.onSuccessNavigate) return block;
                                                return {
                                                  ...block,
                                                  onSuccessNavigate: {
                                                    ...block.onSuccessNavigate,
                                                    params: {
                                                      ...block.onSuccessNavigate.params,
                                                      [parameterId]:
                                                        value === "RESULT"
                                                          ? { source: "RESULT", path: "recordId" }
                                                          : { source: "PARAMS", path: value.slice("PARAMS:".length) },
                                                    },
                                                  },
                                                };
                                              })
                                            }
                                          />
                                        );
                                      }}
                                    </For>
                                  );
                                }}
                              </Show>
                            </div>
                          </Disclosure>
                        </Show>
                      </Show>
                      <Show when={selected().block.type === "record"}>
                        <MultiSelectInput
                          label="Fields"
                          searchable
                          value={() => selectedRecordBlock()?.fieldIds ?? []}
                          options={pageRecordFields().map((field) => ({
                            id: field.id,
                            label: field.name,
                            description: field.type,
                            icon: field.icon ?? "ti ti-column-insert-right",
                          }))}
                          onValueChange={(fieldIds) =>
                            updateSelectedBlock((block) =>
                              block.type === "record"
                                ? {
                                    ...block,
                                    fieldIds: fieldIds.slice(0, 30),
                                    editableFieldIds: block.editableFieldIds.filter((id) => fieldIds.includes(id)),
                                  }
                                : block,
                            )
                          }
                        />
                        <MultiSelectInput
                          label="Editable fields"
                          searchable
                          clearable
                          value={() => selectedRecordBlock()?.editableFieldIds ?? []}
                          options={pageRecordFields()
                            .filter((field) => selectedRecordBlock()?.fieldIds.includes(field.id) && isRecordInputField(field.type))
                            .map((field) => ({
                              id: field.id,
                              label: field.name,
                              description: field.type,
                              icon: field.icon ?? "ti ti-edit",
                            }))}
                          onValueChange={(editableFieldIds) =>
                            updateSelectedBlock((block) =>
                              block.type === "record" ? { ...block, editableFieldIds: editableFieldIds.slice(0, 30) } : block,
                            )
                          }
                        />
                        <Disclosure summary="Documents" icon="ti ti-files" defaultValue={Boolean(selectedRecordBlock()?.documents)}>
                          <MultiSelectInput
                            label="Document templates"
                            description="Allow readers to generate these enabled templates for the page record."
                            searchable
                            clearable
                            value={() => selectedRecordBlock()?.documents?.templateIds ?? []}
                            options={documentTemplateOptions()}
                            onValueChange={(templateIds) =>
                              updateSelectedBlock((block) =>
                                block.type === "record"
                                  ? { ...block, documents: templateIds.length > 0 ? { templateIds: templateIds.slice(0, 12) } : undefined }
                                  : block,
                              )
                            }
                          />
                        </Disclosure>
                      </Show>
                      <Show when={selected().block.type === "actions"}>
                        <div class="flex flex-col gap-2">
                          <For each={selectedActionsBlock()?.actions ?? []}>
                            {(action) => (
                              <DetailPanel.Action
                                title={action.label}
                                description={
                                  action.kind === "workflow"
                                    ? "Run workflow"
                                    : `Open ${draft.draft().pages.find((page) => page.id === action.pageId)?.title ?? "page"}`
                                }
                                leading={
                                  <i
                                    class={
                                      action.icon ? `ti ti-${action.icon}` : action.kind === "workflow" ? "ti ti-player-play" : "ti ti-link"
                                    }
                                    aria-hidden="true"
                                  />
                                }
                                trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                                onClick={() => selectAction(action.id)}
                              />
                            )}
                          </For>
                          <div class="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={addNavigateAction}
                              disabled={(selectedActionsBlock()?.actions.length ?? 0) >= 12}
                            >
                              <i class="ti ti-link-plus" aria-hidden="true" /> Add navigation
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={addWorkflowAction}
                              disabled={workflowLaunchers().length === 0 || (selectedActionsBlock()?.actions.length ?? 0) >= 12}
                            >
                              <i class="ti ti-player-play" aria-hidden="true" /> Add workflow
                            </Button>
                          </div>
                          <Show when={workflowLaunchers().length === 0}>
                            <p class="text-xs text-dimmed">Create an active Custom App workflow launcher to add workflow actions.</p>
                          </Show>
                        </div>
                      </Show>
                      <Show
                        when={
                          selected().block.type === "records" || selected().block.type === "record" || selected().block.type === "comments"
                        }
                      >
                        <TextInput
                          label="Empty state"
                          value={() => {
                            const block = selected().block;
                            return block.type === "records" || block.type === "record" || block.type === "comments"
                              ? (block.emptyText ?? "")
                              : "";
                          }}
                          onValueChange={(emptyText) =>
                            updateSelectedBlock((block) =>
                              block.type === "records" || block.type === "record" || block.type === "comments"
                                ? { ...block, emptyText: emptyText || undefined }
                                : block,
                            )
                          }
                          clearable
                        />
                      </Show>
                      <Show when={selected().block.type === "chart"}>
                        <TextInput
                          label="Subtitle"
                          value={() => {
                            const block = selected().block;
                            return block.type === "chart" ? (block.subtitle ?? "") : "";
                          }}
                          onValueChange={(subtitle) =>
                            updateSelectedBlock((block) => (block.type === "chart" ? { ...block, subtitle: subtitle || undefined } : block))
                          }
                          clearable
                        />
                        <Select
                          label="Chart type"
                          value={() => {
                            const block = selected().block;
                            return block.type === "chart" ? block.chartType : null;
                          }}
                          onValueChange={(chartType) => {
                            const next = chartType ? chartTypeFrom(chartType) : null;
                            if (!next) return;
                            updateSelectedBlock((block) => (block.type === "chart" ? { ...block, chartType: next } : block));
                          }}
                          options={[
                            { id: "bar", label: "Bar" },
                            { id: "line", label: "Line" },
                            { id: "donut", label: "Donut" },
                            { id: "sparkline", label: "Sparkline" },
                            { id: "scatter", label: "Scatter" },
                          ]}
                        />
                        <NumberInput
                          label="Result limit"
                          value={() => {
                            const block = selected().block;
                            return block.type === "chart" ? block.limit : null;
                          }}
                          onValueChange={(limit) => {
                            if (limit === null) return;
                            updateSelectedBlock((block) => (block.type === "chart" ? { ...block, limit } : block));
                          }}
                          min={1}
                          max={100}
                          step={1}
                        />
                        <Disclosure
                          summary="Chart appearance"
                          icon="ti ti-palette"
                          defaultValue={Boolean(
                            selectedChartBlock()?.valueFormat || selectedChartBlock()?.xAxisLabel || selectedChartBlock()?.yAxisLabel,
                          )}
                        >
                          <div class="flex flex-col gap-3">
                            <TextInput
                              label="X-axis label"
                              clearable
                              value={() => selectedChartBlock()?.xAxisLabel ?? ""}
                              onValueChange={(xAxisLabel) =>
                                updateSelectedBlock((block) =>
                                  block.type === "chart" ? { ...block, xAxisLabel: xAxisLabel || undefined } : block,
                                )
                              }
                            />
                            <TextInput
                              label="Y-axis label"
                              clearable
                              value={() => selectedChartBlock()?.yAxisLabel ?? ""}
                              onValueChange={(yAxisLabel) =>
                                updateSelectedBlock((block) =>
                                  block.type === "chart" ? { ...block, yAxisLabel: yAxisLabel || undefined } : block,
                                )
                              }
                            />
                            <Select
                              label="Value format"
                              placeholder="Automatic"
                              clearable
                              value={() => selectedChartBlock()?.valueFormat?.style ?? null}
                              options={[
                                { id: "number", label: "Number" },
                                { id: "integer", label: "Integer" },
                                { id: "percent", label: "Percent" },
                              ]}
                              onValueChange={(style) =>
                                updateSelectedBlock((block) =>
                                  block.type === "chart"
                                    ? {
                                        ...block,
                                        valueFormat:
                                          style === "number" || style === "integer" || style === "percent" ? { style } : undefined,
                                      }
                                    : block,
                                )
                              }
                            />
                            <Show when={selectedChartBlock()?.valueFormat?.style !== "integer" && selectedChartBlock()?.valueFormat}>
                              <NumberInput
                                label="Decimal places"
                                min={0}
                                max={20}
                                step={1}
                                clearable
                                value={() => selectedChartBlock()?.valueFormat?.decimalPlaces ?? null}
                                onValueChange={(decimalPlaces) =>
                                  updateSelectedBlock((block) =>
                                    block.type === "chart" && block.valueFormat
                                      ? {
                                          ...block,
                                          valueFormat: {
                                            ...block.valueFormat,
                                            decimalPlaces: decimalPlaces === null ? undefined : decimalPlaces,
                                          },
                                        }
                                      : block,
                                  )
                                }
                              />
                            </Show>
                            <Show when={selectedChartBlock()?.valueFormat?.style === "number"}>
                              <TextInput
                                label="Unit"
                                clearable
                                value={() =>
                                  selectedChartBlock()?.valueFormat?.style === "number"
                                    ? (selectedChartBlock()?.valueFormat?.unit ?? "")
                                    : ""
                                }
                                onValueChange={(unit) =>
                                  updateSelectedBlock((block) =>
                                    block.type === "chart" && block.valueFormat?.style === "number"
                                      ? {
                                          ...block,
                                          valueFormat: {
                                            ...block.valueFormat,
                                            unit: unit || undefined,
                                            unitPosition: unit ? (block.valueFormat.unitPosition ?? "suffix") : undefined,
                                          },
                                        }
                                      : block,
                                  )
                                }
                              />
                              <Select
                                label="Unit position"
                                value={() =>
                                  selectedChartBlock()?.valueFormat?.style === "number"
                                    ? (selectedChartBlock()?.valueFormat?.unitPosition ?? "suffix")
                                    : "suffix"
                                }
                                options={[
                                  { id: "prefix", label: "Before value" },
                                  { id: "suffix", label: "After value" },
                                ]}
                                onValueChange={(unitPosition) =>
                                  (unitPosition === "prefix" || unitPosition === "suffix") &&
                                  updateSelectedBlock((block) =>
                                    block.type === "chart" && block.valueFormat?.style === "number" && block.valueFormat.unit
                                      ? { ...block, valueFormat: { ...block.valueFormat, unitPosition } }
                                      : block,
                                  )
                                }
                              />
                            </Show>
                          </div>
                        </Disclosure>
                      </Show>
                      <Disclosure summary="Block order" icon="ti ti-arrows-sort">
                        <div class="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={selected().blockIndex === 0}
                            onClick={() => moveSelectedBlock(-1)}
                          >
                            <i class="ti ti-arrow-up" aria-hidden="true" /> Move up
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={selected().blockIndex === selected().column.blocks.length - 1}
                            onClick={() => moveSelectedBlock(1)}
                          >
                            <i class="ti ti-arrow-down" aria-hidden="true" /> Move down
                          </Button>
                        </div>
                      </Disclosure>
                      <Disclosure summary="Danger zone" icon="ti ti-trash">
                        <div class="flex flex-col items-start gap-2">
                          <Button size="sm" variant="danger" disabled={blockCount() === 1} onClick={() => void removeSelectedBlock()}>
                            <i class="ti ti-trash" aria-hidden="true" /> Remove block
                          </Button>
                          <Show when={blockCount() === 1}>
                            <p class="text-xs text-dimmed">A page needs at least one block.</p>
                          </Show>
                        </div>
                      </Disclosure>
                    </div>
                  </DetailPanel.Section>
                </DetailPanel.Group>
              )}
            </Show>
            <Show when={inspectorMode() === "action" && selectedAction()}>
              {(selected) => {
                const selectedLauncher = () =>
                  workflowLaunchers().find((launcher) => launcher.id === selectedWorkflowAction()?.launcherId) ?? null;
                const selectedWorkflow = () => {
                  const launcher = selectedLauncher();
                  return launcher ? (workflowsById().get(launcher.workflowId) ?? null) : null;
                };
                return (
                  <>
                    <DetailPanel.Action
                      title="Back to actions"
                      description={selectedActionsBlock()?.title || "Actions block"}
                      leading={<i class="ti ti-arrow-left" aria-hidden="true" />}
                      onClick={() => {
                        setSelectedActionId(null);
                        setInspectorMode("block");
                      }}
                    />
                    <DetailPanel.Group label="Action settings">
                      <DetailPanel.Section title="Action" icon="ti ti-bolt" tone="accent">
                        <div class="flex flex-col gap-3">
                          <TextInput
                            label="Label"
                            value={() => selected().action.label}
                            onValueChange={(label) => updateSelectedAction((action) => ({ ...action, label }))}
                            required
                          />
                          <IconInput
                            label="Icon"
                            value={() => iconInputValue(selected().action.icon)}
                            onValueChange={(value) => updateSelectedAction((action) => ({ ...action, icon: iconSlug(value) }))}
                            clearable
                          />
                          <Select
                            label="Action type"
                            value={() => selected().action.kind}
                            options={[
                              { id: "navigate", label: "Open page", icon: "ti ti-link" },
                              {
                                id: "workflow",
                                label: "Run workflow",
                                icon: "ti ti-player-play",
                                disabled: workflowLaunchers().length === 0,
                              },
                            ]}
                            onValueChange={(kind) => {
                              if (kind === selected().action.kind) return;
                              if (kind === "navigate") {
                                const page =
                                  draft.draft().pages.find((candidate) => Object.keys(candidate.parameters).length === 0) ??
                                  draft.draft().pages[0]!;
                                updateSelectedAction((action) => ({
                                  id: action.id,
                                  label: action.label,
                                  icon: action.icon,
                                  availableWhen: action.availableWhen,
                                  kind: "navigate",
                                  pageId: page.id,
                                  history: "push",
                                  params: defaultNavigationParams(page.id),
                                }));
                              }
                              if (kind === "workflow") {
                                const launcher = workflowLaunchers()[0];
                                if (!launcher) return;
                                updateSelectedAction((action) => ({
                                  id: action.id,
                                  label: action.label,
                                  icon: action.icon,
                                  availableWhen: action.availableWhen,
                                  kind: "workflow",
                                  launcherId: launcher.id,
                                  inputs: {},
                                }));
                              }
                            }}
                          />
                        </div>
                      </DetailPanel.Section>
                      <Show when={selectedNavigateAction()}>
                        {(action) => (
                          <DetailPanel.Section title="Navigation" icon="ti ti-route">
                            <div class="flex flex-col gap-3">
                              <Select
                                label="Target page"
                                value={() => action().pageId}
                                options={draft.draft().pages.map((page) => ({ id: page.id, label: page.title }))}
                                onValueChange={(pageId) =>
                                  pageId &&
                                  updateSelectedAction((action) =>
                                    action.kind === "navigate" ? { ...action, pageId, params: defaultNavigationParams(pageId) } : action,
                                  )
                                }
                              />
                              <Select
                                label="Browser history"
                                value={() => action().history}
                                options={[
                                  { id: "push", label: "Add to history" },
                                  { id: "replace", label: "Replace current page" },
                                ]}
                                onValueChange={(history) =>
                                  (history === "push" || history === "replace") &&
                                  updateSelectedAction((action) => (action.kind === "navigate" ? { ...action, history } : action))
                                }
                              />
                              {(() => {
                                const target = () => draft.draft().pages.find((page) => page.id === action().pageId);
                                return (
                                  <For each={Object.entries(target()?.parameters ?? {})}>
                                    {([parameterId, parameter]) => {
                                      const options = () => [
                                        ...(selectedPage().record?.tableId === parameter.tableId
                                          ? [{ id: "RECORD", label: "Current page record" }]
                                          : []),
                                        ...Object.entries(selectedPage().parameters)
                                          .filter(([, candidate]) => candidate.tableId === parameter.tableId)
                                          .map(([sourceId]) => ({ id: `PARAMS:${sourceId}`, label: `@params.${sourceId}` })),
                                      ];
                                      const current = () => action().params[parameterId];
                                      return (
                                        <Select
                                          label={`Value for ${parameterId}`}
                                          value={() => {
                                            const value = current();
                                            return value?.source === "RECORD" ? "RECORD" : value ? `PARAMS:${value.path}` : null;
                                          }}
                                          options={options()}
                                          error={() => (current() ? undefined : "Choose a compatible record source.")}
                                          onValueChange={(value) =>
                                            value &&
                                            updateSelectedAction((candidate) =>
                                              candidate.kind === "navigate"
                                                ? {
                                                    ...candidate,
                                                    params: {
                                                      ...candidate.params,
                                                      [parameterId]:
                                                        value === "RECORD"
                                                          ? { source: "RECORD", path: "id" }
                                                          : { source: "PARAMS", path: value.slice("PARAMS:".length) },
                                                    },
                                                  }
                                                : candidate,
                                            )
                                          }
                                        />
                                      );
                                    }}
                                  </For>
                                );
                              })()}
                            </div>
                          </DetailPanel.Section>
                        )}
                      </Show>
                      <Show when={selectedWorkflowAction()}>
                        {(workflowAction) => (
                          <DetailPanel.Section title="Workflow" icon="ti ti-player-play">
                            <div class="flex flex-col gap-3">
                              <Select
                                label="Launcher"
                                searchable
                                value={() => workflowAction().launcherId}
                                options={workflowLauncherOptions()}
                                onValueChange={(launcherId) =>
                                  launcherId &&
                                  updateSelectedAction((action) =>
                                    action.kind === "workflow" ? { ...action, launcherId, inputs: {} } : action,
                                  )
                                }
                              />
                              <Show when={selectedLauncher()?.config.inputMode === "fixed"}>
                                <p class="text-sm text-dimmed">This launcher supplies its own fixed workflow inputs.</p>
                              </Show>
                              <Show when={selectedLauncher()?.config.inputMode === "prompt"}>
                                <For each={selectedWorkflow()?.plan.inputs ?? []}>
                                  {(input) => {
                                    const boundTableId = () => {
                                      const workflow = selectedWorkflow();
                                      const value = workflow?.plan.bindings[`inputs.${input.name}.table`];
                                      return typeof value === "string" ? value : null;
                                    };
                                    const inputValue = () => workflowAction().inputs[input.name];
                                    const literalInputValue = () => {
                                      const value = inputValue();
                                      return value?.source === "LITERAL" ? value : null;
                                    };
                                    const sourceOptions = () => [
                                      { id: "LITERAL", label: "Fixed value" },
                                      ...(input.type === "record" && selectedPage().record?.tableId === boundTableId()
                                        ? [{ id: "RECORD", label: "Current page record" }]
                                        : []),
                                      ...(input.type === "record"
                                        ? Object.entries(selectedPage().parameters)
                                            .filter(([, parameter]) => parameter.tableId === boundTableId())
                                            .map(([parameterId]) => ({ id: `PARAMS:${parameterId}`, label: `@params.${parameterId}` }))
                                        : []),
                                    ];
                                    return (
                                      <div class="flex flex-col gap-2">
                                        <Select
                                          label={typeof input.config.label === "string" ? input.config.label : input.name}
                                          description={typeof input.config.description === "string" ? input.config.description : undefined}
                                          placeholder="Not supplied"
                                          clearable
                                          value={() => {
                                            const value = inputValue();
                                            if (!value) return null;
                                            return value.source === "PARAMS" ? `PARAMS:${value.path}` : value.source;
                                          }}
                                          options={sourceOptions()}
                                          onValueChange={(source) =>
                                            updateSelectedAction((action) => {
                                              if (action.kind !== "workflow") return action;
                                              const inputs = { ...action.inputs };
                                              if (!source) delete inputs[input.name];
                                              else if (source === "RECORD") inputs[input.name] = { source: "RECORD", path: "id" };
                                              else if (source.startsWith("PARAMS:")) {
                                                inputs[input.name] = { source: "PARAMS", path: source.slice("PARAMS:".length) };
                                              } else {
                                                inputs[input.name] = { source: "LITERAL", value: null };
                                              }
                                              return { ...action, inputs };
                                            })
                                          }
                                        />
                                        <Show when={literalInputValue()}>
                                          {(value) => (
                                            <JsonValueInput
                                              label={`${input.name} value`}
                                              value={value().value}
                                              onValueChange={(next) =>
                                                updateSelectedAction((action) =>
                                                  action.kind === "workflow"
                                                    ? {
                                                        ...action,
                                                        inputs: {
                                                          ...action.inputs,
                                                          [input.name]: { source: "LITERAL", value: next },
                                                        },
                                                      }
                                                    : action,
                                                )
                                              }
                                            />
                                          )}
                                        </Show>
                                      </div>
                                    );
                                  }}
                                </For>
                              </Show>
                              <TextInput
                                label="Confirmation message"
                                description="Optional. Ask the user before invoking the workflow."
                                clearable
                                value={() => selectedWorkflowAction()?.confirm ?? ""}
                                onValueChange={(confirm) =>
                                  updateSelectedAction((action) =>
                                    action.kind === "workflow" ? { ...action, confirm: confirm || undefined } : action,
                                  )
                                }
                              />
                            </div>
                          </DetailPanel.Section>
                        )}
                      </Show>
                      <CustomAppAvailabilitySection
                        baseId={draft.draft().baseId}
                        contextKeys={contextKeys()}
                        targetLabel={selected().action.label}
                        value={() => selected().action.availableWhen?.query ?? ""}
                        onValueChange={(query) =>
                          updateSelectedAction((action) => ({
                            ...action,
                            availableWhen: query.trim() ? { query } : undefined,
                          }))
                        }
                        error={() => diagnosticFor(selected().action.id, "availableWhen")}
                      />
                      <DetailPanel.Section title="Order" icon="ti ti-arrows-sort" collapsible defaultOpen={false}>
                        <div class="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" disabled={selected().index === 0} onClick={() => moveSelectedAction(-1)}>
                            <i class="ti ti-arrow-up" aria-hidden="true" /> Move up
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={selected().index === (selectedActionsBlock()?.actions.length ?? 1) - 1}
                            onClick={() => moveSelectedAction(1)}
                          >
                            <i class="ti ti-arrow-down" aria-hidden="true" /> Move down
                          </Button>
                        </div>
                      </DetailPanel.Section>
                      <DetailPanel.Section title="Danger zone" icon="ti ti-trash" tone="danger" collapsible defaultOpen={false}>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={(selectedActionsBlock()?.actions.length ?? 0) <= 1}
                          onClick={() => void removeSelectedAction()}
                        >
                          <i class="ti ti-trash" aria-hidden="true" /> Remove action
                        </Button>
                      </DetailPanel.Section>
                    </DetailPanel.Group>
                  </>
                );
              }}
            </Show>
          </DetailPanel.Body>
        </DetailPanel>
      </AppWorkspace.Detail>
    </>
  );
}
