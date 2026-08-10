import type { DateContext } from "@k2b/stdlib";
import { dnd, mutation as mutations } from "@k2b/stdlib/solid";
import {
  AppWorkspace,
  Button,
  ButtonLink,
  DetailPanel,
  Dropdown,
  IconButton,
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
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewResponse } from "../../../contracts";
import type { CustomAppBlock, CustomAppDefinition, CustomAppDiagnostic } from "../../../custom-apps/contracts";
import type { CustomApp, Field, View } from "../../../service";
import type { CustomAppDraftSave } from "../../../service/custom-apps";
import { type CustomAppBlockDragMeta, type CustomAppBlockDropMeta, CustomAppPageLayout } from "../../custom-app/PageLayout";
import { GqlSourceEditor } from "../query/GqlSourceEditor";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceCatalog } from "../workspace/workspace-state-model";
import CustomAppBlockPreview from "./CustomAppBlockPreview";
import {
  applyCustomAppBlockDrop,
  type CustomAppBlockDropIntent,
  type CustomAppLayoutIds,
  normalizeCustomAppPageLayout,
  sameCustomAppBlockDropIntent,
  selectCustomAppBlockDropTarget,
} from "./custom-app-builder-dnd";
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

export default function CustomAppBuilder(props: {
  app: CustomApp;
  catalog: WorkspaceCatalog;
  dateConfig?: DateContext;
  initialPreviewResults?: Record<string, DslQueryPreviewResponse>;
  initialInspectorMode?: "app" | "page";
}) {
  const [app, setApp] = createSignal(props.app);
  const draft = createCustomAppBuilderState(props.app.draftDefinition);
  const [diagnostics, setDiagnostics] = createSignal<CustomAppDiagnostic[]>([]);
  const [saveState, setSaveState] = createSignal<"idle" | "saving" | "saved" | "error" | "invalid">(
    props.app.draftValid === false ? "invalid" : "idle",
  );
  const [saveError, setSaveError] = createSignal<string | null>(
    props.app.draftValid === false ? "The saved draft must be fixed before it can be published." : null,
  );
  const [selectedPageId, setSelectedPageId] = createSignal(props.app.draftDefinition.startPageId);
  const [selectedBlockId, setSelectedBlockId] = createSignal<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = createSignal(true);
  const [inspectorMode, setInspectorMode] = createSignal<"app" | "page" | "block">(props.initialInspectorMode ?? "page");
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
  const selectedActionsBlock = createMemo(() => {
    const block = selectedBlock()?.block;
    return block?.type === "actions" ? block : null;
  });
  const blockCount = createMemo(() =>
    selectedPage().rows.reduce((total, row) => total + row.columns.reduce((sum, column) => sum + column.blocks.length, 0), 0),
  );
  const tablesById = createMemo(() => new Map(props.catalog.tables.map((table) => [table.id, table])));
  const tableOptions = createMemo(() =>
    props.catalog.tables.map((table) => ({ value: table.id, label: table.name, icon: table.icon ?? "ti ti-table" })),
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
    const view = selectedRecordsView();
    return view ? (viewResources().find((resource) => resource.view.id === view.id)?.fields ?? []) : [];
  });
  const selectedRecordsFieldOptions = createMemo(() =>
    selectedRecordsFields().map((field) => ({
      id: field.id,
      label: field.name,
      description: field.type,
      icon: field.icon ?? "ti ti-column-insert-right",
    })),
  );
  const diagnosticsForSelection = createMemo(() => {
    const selectedId = selectedBlockId();
    const pageId = selectedPage().id;
    return diagnostics().filter((diagnostic) => {
      if (selectedId && diagnostic.path.includes(selectedId)) return true;
      if (!selectedId && diagnostic.path.includes(pageId)) return true;
      return !diagnostic.path.includes("blocks") && !diagnostic.path.includes("pages");
    });
  });
  const diagnosticFor = (blockId: string, segment: string) =>
    diagnostics().find((diagnostic) => diagnostic.path.includes(blockId) && diagnostic.path.includes(segment))?.message;

  const selectPage = (pageId: string) => {
    setSelectedPageId(pageId);
    setSelectedBlockId(null);
    setInspectorMode("page");
    setInspectorOpen(true);
  };

  const selectBlock = (blockId: string) => {
    setSelectedBlockId(blockId);
    setInspectorMode("block");
    setInspectorOpen(true);
  };

  const setDefinition = (update: (current: CustomAppDefinition) => CustomAppDefinition) => {
    setDiagnostics([]);
    draft.set(update(draft.snapshot()));
  };

  const patchPage = (patch: Partial<CustomAppPage>) => {
    const pageId = selectedPage().id;
    setDefinition((definition) => ({
      ...definition,
      pages: definition.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
    }));
  };

  const updateSelectedBlock = (update: (block: CustomAppBlock) => CustomAppBlock) => {
    const selected = selectedBlock();
    if (!selected) return;
    setDiagnostics([]);
    draft.updateBlock(selectedPage().id, selected.block.id, update);
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
              <AppWorkspace.SidebarItem tone="success" onClick={addPage}>
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
              inspectorMode() === "block"
                ? blockMeta[selectedBlock()?.block.type ?? "markdown"].icon
                : inspectorMode() === "app"
                  ? "ti ti-app-window"
                  : "ti ti-file-settings"
            }
            title={
              inspectorMode() === "block"
                ? selectedBlock()?.block.title || blockMeta[selectedBlock()?.block.type ?? "markdown"].label
                : inspectorMode() === "app"
                  ? "App settings"
                  : selectedPage().title
            }
            subtitle={inspectorMode() === "block" ? "Content block" : inspectorMode() === "app" ? draft.draft().name : "Page settings"}
            actions={
              <IconButton size="sm" label="Close inspector" onClick={() => setInspectorOpen(false)}>
                <i class="ti ti-x" aria-hidden="true" />
              </IconButton>
            }
          />
          <DetailPanel.Body
            scrollPreserveKey={`grids-custom-app-inspector-${app().id}-${inspectorMode()}-${selectedBlockId() ?? selectedPage().id}`}
          >
            <Show when={diagnosticsForSelection().length > 0}>
              <NoticeCard tone="danger" icon={false} role="alert">
                <p class="font-medium">This draft needs attention</p>
                <ul class="mt-2 list-disc space-y-1 pl-4 text-sm">
                  <For each={diagnosticsForSelection()}>{(diagnostic) => <li>{diagnostic.message}</li>}</For>
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
                    <TextInput
                      label="Icon"
                      description="Tabler icon slug, for example app-window."
                      value={() => draft.draft().icon ?? ""}
                      onValueChange={(icon) => setDefinition((definition) => ({ ...definition, icon: icon.trim() || undefined }))}
                    />
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
                      value={() => selectedPage().navigation.visible}
                      onValueChange={(visible) => patchPage({ navigation: { ...selectedPage().navigation, visible } })}
                    />
                    <Select
                      label="Page record"
                      description="Adds a required record_id page parameter for Record and Comments blocks."
                      placeholder="No page record"
                      clearable
                      value={() => selectedPage().record?.tableId ?? null}
                      options={tableOptions()}
                      onValueChange={(tableId) => {
                        if (!tableId) {
                          patchPage({ record: undefined });
                          return;
                        }
                        patchPage({
                          parameters: {
                            ...selectedPage().parameters,
                            record_id: { type: "record", tableId, required: true },
                          },
                          record: { tableId, id: { source: "PARAMS", path: "record_id" } },
                        });
                      }}
                    />
                    <Show
                      when={draft.draft().startPageId === selectedPage().id}
                      fallback={
                        <Button
                          size="sm"
                          variant="secondary"
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
                <DetailPanel.Section title="Danger zone" icon="ti ti-trash" tone="danger">
                  <Button size="sm" variant="danger" disabled={draft.draft().pages.length === 1} onClick={() => void removePage()}>
                    <i class="ti ti-trash" aria-hidden="true" /> Remove page
                  </Button>
                </DetailPanel.Section>
              </DetailPanel.Group>
            </Show>

            <Show when={inspectorMode() === "block" && selectedBlock()}>
              {(selected) => (
                <DetailPanel.Group label="Block settings">
                  <DetailPanel.Section title="Content block" icon={blockMeta[selected().block.type].icon} tone="accent">
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
                          <GqlSourceEditor
                            baseId={draft.draft().baseId}
                            label="GQL"
                            description="Use params with param('name'); parameterized queries preview once a page value exists."
                            lines={10}
                            spellcheck={false}
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
                            updateSelectedBlock((block) => (block.type === "form" ? { ...block, formId } : block));
                          }}
                        />
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
                            .filter((field) => selectedRecordBlock()?.fieldIds.includes(field.id))
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
                      </Show>
                      <Show when={selected().block.type === "actions"}>
                        <For each={selectedActionsBlock()?.actions ?? []}>
                          {(action) => (
                            <div class="flex flex-col gap-3 rounded-lg border border-subtle p-3">
                              <TextInput
                                label="Action label"
                                value={() => action.label}
                                onValueChange={(label) =>
                                  updateSelectedBlock((block) =>
                                    block.type === "actions"
                                      ? {
                                          ...block,
                                          actions: block.actions.map((candidate) =>
                                            candidate.id === action.id ? { ...candidate, label } : candidate,
                                          ),
                                        }
                                      : block,
                                  )
                                }
                              />
                              <Show when={action.kind === "navigate"}>
                                <Select
                                  label="Target page"
                                  value={() => (action.kind === "navigate" ? action.pageId : null)}
                                  options={draft.draft().pages.map((page) => ({ id: page.id, label: page.title }))}
                                  onValueChange={(pageId) =>
                                    pageId &&
                                    updateSelectedBlock((block) =>
                                      block.type === "actions"
                                        ? {
                                            ...block,
                                            actions: block.actions.map((candidate) =>
                                              candidate.id === action.id && candidate.kind === "navigate"
                                                ? { ...candidate, pageId }
                                                : candidate,
                                            ),
                                          }
                                        : block,
                                    )
                                  }
                                />
                              </Show>
                            </div>
                          )}
                        </For>
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
                      </Show>
                      <div class="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" disabled={selected().blockIndex === 0} onClick={() => moveSelectedBlock(-1)}>
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
                      <Button size="sm" variant="danger" disabled={blockCount() === 1} onClick={() => void removeSelectedBlock()}>
                        <i class="ti ti-trash" aria-hidden="true" /> Remove block
                      </Button>
                      <Show when={blockCount() === 1}>
                        <p class="text-xs text-dimmed">A page needs at least one block.</p>
                      </Show>
                    </div>
                  </DetailPanel.Section>
                </DetailPanel.Group>
              )}
            </Show>
          </DetailPanel.Body>
        </DetailPanel>
      </AppWorkspace.Detail>
    </>
  );
}
