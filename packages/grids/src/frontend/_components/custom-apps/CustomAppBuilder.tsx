import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  AppWorkspace,
  Button,
  ButtonLink,
  IconButton,
  NumberInput,
  prompts,
  Select,
  StatusBadge,
  Switch,
  TextInput,
  Toolbar,
} from "@k2b/ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { CustomAppDefinition } from "../../../custom-apps/contracts";
import type { CustomApp } from "../../../service";
import { createDraft } from "../editor-draft";
import { errorMessage } from "../utils/api-helpers";

type CustomAppPage = CustomAppDefinition["pages"][number];
type CustomAppRow = CustomAppPage["rows"][number];
type CustomAppColumn = CustomAppRow["columns"][number];
type CustomAppBlock = CustomAppPage["rows"][number]["columns"][number]["blocks"][number];
type SelectedBlock = {
  block: CustomAppBlock;
  blockIndex: number;
  column: CustomAppColumn;
  row: CustomAppRow;
};

const cloneDefinition = (definition: CustomAppDefinition): CustomAppDefinition => structuredClone(definition);
const localId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

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

const blockDescription = (block: CustomAppBlock): string => {
  switch (block.type) {
    case "actions":
      return `${block.actions.length} action${block.actions.length === 1 ? "" : "s"}`;
    case "chart":
      return `${block.chartType} chart`;
    case "comments":
      return "Record discussion";
    case "form":
      return "Record form";
    case "markdown":
      return block.markdown.trim().split("\n")[0]?.slice(0, 90) || "Empty markdown";
    case "metrics":
      return "Summary metrics";
    case "record":
      return `${block.fieldIds.length} field${block.fieldIds.length === 1 ? "" : "s"}`;
    case "records":
      return `${block.display.columnIds.length} column${block.display.columnIds.length === 1 ? "" : "s"}`;
  }
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

export default function CustomAppBuilder(props: { app: CustomApp }) {
  const [app, setApp] = createSignal(props.app);
  const draft = createDraft(cloneDefinition(props.app.draftDefinition));
  const [selectedPageId, setSelectedPageId] = createSignal(props.app.draftDefinition.startPageId);
  const [selectedBlockId, setSelectedBlockId] = createSignal<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = createSignal(true);
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

  const selectPage = (pageId: string) => {
    setSelectedPageId(pageId);
    setSelectedBlockId(null);
    setInspectorOpen(true);
  };

  const selectBlock = (blockId: string) => {
    setSelectedBlockId(blockId);
    setInspectorOpen(true);
  };

  const setDefinition = (update: (current: CustomAppDefinition) => CustomAppDefinition) => {
    draft.set(update(draft.draft()));
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
    patchPage({
      rows: selectedPage().rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => ({
          ...column,
          blocks: column.blocks.map((block) => (block.id === selected.block.id ? update(block) : block)),
        })),
      })),
    });
  };

  const patchSelectedColumn = (span: number) => {
    const selected = selectedBlock();
    if (!selected) return;
    patchPage({
      rows: selectedPage().rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => (column.id === selected.column.id ? { ...column, span } : column)),
      })),
    });
  };

  const maxSelectedColumnSpan = createMemo(() => {
    const selected = selectedBlock();
    if (!selected) return 12;
    const occupied = selected.row.columns.reduce((total, column) => total + (column.id === selected.column.id ? 0 : column.span), 0);
    return Math.max(1, 12 - occupied);
  });

  const addTextBlock = () => {
    const selected = selectedBlock();
    const targetColumnId = selected?.column.id ?? selectedPage().rows[0]!.columns[0]!.id;
    const block: CustomAppBlock = { id: localId("markdown"), type: "markdown", markdown: "" };
    patchPage({
      rows: selectedPage().rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => (column.id === targetColumnId ? { ...column, blocks: [...column.blocks, block] } : column)),
      })),
    });
    selectBlock(block.id);
  };

  const moveSelectedBlock = (direction: -1 | 1) => {
    const selected = selectedBlock();
    if (!selected) return;
    const nextIndex = selected.blockIndex + direction;
    if (nextIndex < 0 || nextIndex >= selected.column.blocks.length) return;
    const blocks = [...selected.column.blocks];
    [blocks[selected.blockIndex], blocks[nextIndex]] = [blocks[nextIndex]!, blocks[selected.blockIndex]!];
    patchPage({
      rows: selectedPage().rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => (column.id === selected.column.id ? { ...column, blocks } : column)),
      })),
    });
  };

  const removeSelectedBlock = async () => {
    const selected = selectedBlock();
    if (!selected || selected.column.blocks.length === 1) return;
    const confirmed = await prompts.confirm(`Remove "${selected.block.title || blockMeta[selected.block.type].label}" from this page?`, {
      title: "Remove block",
      icon: "ti ti-trash",
      confirmText: "Remove",
      variant: "danger",
    });
    if (!confirmed) return;
    patchPage({
      rows: selectedPage().rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) =>
          column.id === selected.column.id
            ? { ...column, blocks: column.blocks.filter((block) => block.id !== selected.block.id) }
            : column,
        ),
      })),
    });
    setSelectedBlockId(null);
  };

  const persistDraft = async (abortSignal?: AbortSignal): Promise<CustomApp> => {
    const response = await apiClient.apps.apply.$post(
      { json: { definition: draft.draft() } },
      abortSignal ? { init: { signal: abortSignal } } : undefined,
    );
    if (!response.ok) throw new Error(await errorMessage(response, "Could not save the Custom App draft."));
    const saved = (await response.json()) as CustomApp;
    setApp(saved);
    draft.markSaved(cloneDefinition(saved.draftDefinition));
    return saved;
  };

  const saveMutation = mutations.create<CustomApp, void>({
    mutation: (_, { abortSignal }) => persistDraft(abortSignal),
    onSuccess: () => prompts.success("Custom App draft saved."),
    onError: (error) => prompts.error(error.message),
  });

  const publishMutation = mutations.create<CustomApp, void>({
    mutation: async (_, { abortSignal }) => {
      const saved = await persistDraft(abortSignal);
      const response = await apiClient.apps[":appId"].publish.$post({ param: { appId: saved.id } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not publish the Custom App."));
      return (await response.json()) as CustomApp;
    },
    onSuccess: (published) => {
      setApp(published);
      draft.markSaved(cloneDefinition(published.draftDefinition));
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

  const reset = () => {
    draft.reset();
    selectPage(draft.draft().startPageId);
  };

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
            <Toolbar.Group>
              <Button size="xs" variant="ghost" onClick={addPage}>
                <i class="ti ti-plus" aria-hidden="true" /> Add
              </Button>
            </Toolbar.Group>
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
                  </AppWorkspace.SidebarItem>
                )}
              </For>
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarBody>
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
              <Button
                size="xs"
                variant="secondary"
                aria-pressed={inspectorOpen() && selectedBlock() === null}
                onClick={() => selectPage(selectedPage().id)}
              >
                <i class="ti ti-settings" aria-hidden="true" /> Page settings
              </Button>
              <Button size="xs" variant="secondary" onClick={addTextBlock}>
                <i class="ti ti-plus" aria-hidden="true" /> Add text
              </Button>
              <Button size="xs" variant="ghost" disabled={!draft.dirty()} onClick={reset}>
                Reset
              </Button>
              <Show when={app().publishedAt}>
                <ButtonLink size="xs" variant="secondary" href={`/apps/${app().shortId}`} target="_blank" rel="noreferrer">
                  <i class="ti ti-external-link" aria-hidden="true" /> Preview
                </ButtonLink>
              </Show>
              <Button
                size="xs"
                variant="secondary"
                loading={saveMutation.loading()}
                disabled={!draft.dirty() || publishMutation.loading()}
                onClick={() => saveMutation.mutate(undefined)}
              >
                Save
              </Button>
              <Button
                size="xs"
                loading={publishMutation.loading()}
                disabled={saveMutation.loading()}
                onClick={() => publishMutation.mutate(undefined)}
              >
                Publish
              </Button>
            </Toolbar.Group>
          </Toolbar>

          <div class="min-h-0 flex-1 overflow-auto p-[var(--ui-space-shell)]">
            <div class="mx-auto flex w-full max-w-6xl flex-col gap-4">
              <header class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-wider text-dimmed">Canvas</p>
                  <h1 class="text-xl font-semibold">{selectedPage().title}</h1>
                  <p class="mt-1 text-sm text-dimmed">Select a block to edit its content and layout.</p>
                </div>
                <code class="rounded bg-subtle px-2 py-1 text-xs text-dimmed">{selectedPage().id}</code>
              </header>
              <For each={selectedPage().rows}>
                {(row) => (
                  <div class="grid grid-cols-12 gap-3" data-row-id={row.id}>
                    <For each={row.columns}>
                      {(column) => (
                        <div class="flex min-w-0 flex-col gap-3" style={{ "grid-column": `span ${column.span} / span ${column.span}` }}>
                          <For each={column.blocks}>
                            {(block) => {
                              const meta = blockMeta[block.type];
                              return (
                                <button
                                  type="button"
                                  class="grids-builder-block paper flex min-h-28 w-full cursor-pointer flex-col gap-3 p-4 text-left transition-colors hover:bg-subtle focus-visible:outline-none"
                                  data-block-id={block.id}
                                  data-selected={selectedBlock()?.block.id === block.id}
                                  aria-pressed={selectedBlock()?.block.id === block.id}
                                  onClick={() => selectBlock(block.id)}
                                >
                                  <div class="flex items-center gap-2">
                                    <i class={`${meta.icon} text-dimmed`} aria-hidden="true" />
                                    <strong class="text-sm">{block.title || meta.label}</strong>
                                    <span class="ml-auto text-xs text-dimmed">{meta.label}</span>
                                  </div>
                                  <p class="text-sm text-dimmed">{blockDescription(block)}</p>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </div>
        </section>
      </AppWorkspace.Main>

      <AppWorkspace.Detail id="custom-app-inspector" open={inspectorOpen()} width="md" resizable minWidth={280} maxWidth={520}>
        <div class="flex h-full min-h-0 flex-col">
          <header class="flex items-start justify-between gap-3 p-4">
            <div>
              <p class="text-xs uppercase tracking-wider text-dimmed">Inspector</p>
              <h2 class="font-semibold">{selectedBlock() ? "Edit block" : "Page settings"}</h2>
            </div>
            <IconButton size="sm" label="Close page inspector" onClick={() => setInspectorOpen(false)}>
              <i class="ti ti-x" aria-hidden="true" />
            </IconButton>
          </header>
          <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4 pt-1">
            <Show when={selectedBlock() === null}>
              <section class="flex flex-col gap-3" aria-labelledby="custom-app-settings-heading">
                <h3 id="custom-app-settings-heading" class="text-xs font-semibold uppercase tracking-wider text-dimmed">
                  App
                </h3>
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
              </section>

              <section class="flex flex-col gap-3" aria-labelledby="custom-page-settings-heading">
                <h3 id="custom-page-settings-heading" class="text-xs font-semibold uppercase tracking-wider text-dimmed">
                  Selected page
                </h3>
                <TextInput label="Title" value={() => selectedPage().title} onValueChange={(title) => patchPage({ title })} required />
                <Switch
                  label="Show in app navigation"
                  value={() => selectedPage().navigation.visible}
                  onValueChange={(visible) => patchPage({ navigation: { ...selectedPage().navigation, visible } })}
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
                <Button size="sm" variant="danger" disabled={draft.draft().pages.length === 1} onClick={() => void removePage()}>
                  <i class="ti ti-trash" aria-hidden="true" /> Remove page
                </Button>
              </section>
            </Show>

            <Show when={selectedBlock()}>
              {(selected) => (
                <section class="flex flex-col gap-4" aria-labelledby="custom-block-settings-heading">
                  <div>
                    <h3 id="custom-block-settings-heading" class="text-xs font-semibold uppercase tracking-wider text-dimmed">
                      Content block
                    </h3>
                    <p class="mt-1 text-sm text-dimmed">{blockMeta[selected().block.type].label}</p>
                  </div>
                  <TextInput
                    label="Title"
                    value={() => selected().block.title ?? ""}
                    onValueChange={(title) => updateSelectedBlock((block) => ({ ...block, title: title || undefined }) as CustomAppBlock)}
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
                    when={selected().block.type === "records" || selected().block.type === "record" || selected().block.type === "comments"}
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
                        if (!chartType) return;
                        updateSelectedBlock((block) => (block.type === "chart" ? { ...block, chartType } : block));
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
                  <NumberInput
                    label="Column width"
                    description="Columns in one row share a 12-column grid."
                    value={() => selected().column.span}
                    onValueChange={(span) => {
                      if (span !== null) patchSelectedColumn(span);
                    }}
                    min={1}
                    max={maxSelectedColumnSpan()}
                    step={1}
                  />
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
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={selected().column.blocks.length === 1}
                    onClick={() => void removeSelectedBlock()}
                  >
                    <i class="ti ti-trash" aria-hidden="true" /> Remove block
                  </Button>
                  <Show when={selected().column.blocks.length === 1}>
                    <p class="text-xs text-dimmed">Add another block before removing the last block in a column.</p>
                  </Show>
                </section>
              )}
            </Show>
          </div>
        </div>
      </AppWorkspace.Detail>
    </>
  );
}
