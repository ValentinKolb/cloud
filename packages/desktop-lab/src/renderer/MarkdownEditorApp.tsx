import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { AppWorkspace, Chart, MarkdownEditor, MarkdownView, SegmentedControl, StatCell, toast } from "@valentinkolb/cloud/ui";
import { desktop } from "@valentinkolb/cloud/desktop";
import { DesktopWorkspace, workspace as desktopWorkspace } from "@valentinkolb/cloud/desktop/solid";
import type {
  DesktopLabBridge,
  MarkdownDirectoryNode,
  MarkdownFileContent,
  MarkdownFileNode,
  MarkdownFolder,
  MarkdownTreeNode,
  MarkdownWorkspace,
} from "../bridge/types";

type Mode = "edit" | "preview";

type Props = {
  bridge: DesktopLabBridge;
  DocumentWindow: (props: { filePath: string; fileName: string }) => JSX.Element;
};

const emptyWorkspace: MarkdownWorkspace = {
  folders: [],
  lastFilePath: null,
};

const readResult = async <T,>(action: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> => {
  const result = await action;
  if (!result.ok) throw new Error(result.error);
  return result.data;
};

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const inlineMarkdown = (value: string) =>
  escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

export const renderMarkdown = (source: string) =>
  source
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      const first = lines[0]?.trim() ?? "";
      if (first.startsWith("# ")) return `<h1>${inlineMarkdown(first.slice(2))}</h1>`;
      if (first.startsWith("## ")) return `<h2>${inlineMarkdown(first.slice(3))}</h2>`;
      if (first.startsWith("### ")) return `<h3>${inlineMarkdown(first.slice(4))}</h3>`;
      if (lines.every((line) => line.trim().startsWith("- "))) {
        return `<ul>${lines.map((line) => `<li>${inlineMarkdown(line.trim().slice(2))}</li>`).join("")}</ul>`;
      }
      if (first.startsWith("> "))
        return `<blockquote>${lines.map((line) => inlineMarkdown(line.replace(/^>\s?/, ""))).join("<br>")}</blockquote>`;
      return `<p>${lines.map(inlineMarkdown).join("<br>")}</p>`;
    })
    .join("");

const flattenFiles = (nodes: MarkdownTreeNode[]): MarkdownFileNode[] =>
  nodes.flatMap((node) => (node.kind === "file" ? [node] : flattenFiles(node.children)));

const findFile = (workspace: MarkdownWorkspace, path: string | null): MarkdownFileNode | null => {
  if (!path) return null;
  for (const folder of workspace.folders) {
    const found = flattenFiles(folder.tree).find((file) => file.path === path);
    if (found) return found;
  }
  return null;
};

const collectDirectoryIds = (nodes: MarkdownTreeNode[], ids: Set<string>) => {
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    ids.add(node.id);
    collectDirectoryIds(node.children, ids);
  }
};

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const formatTime = (value: string) => new Date(value).toLocaleString();

const extractDocumentStats = (markdown: string) => {
  let headings = 0;
  let openTasks = 0;
  let doneTasks = 0;
  let links = 0;

  markdown.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) headings += 1;

    const task = /^[-*]\s+\[([ xX])\]\s+/.exec(trimmed);
    if (task) {
      if (task[1]!.toLowerCase() === "x") doneTasks += 1;
      else openTasks += 1;
    }

    links += [...line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].length;
  });

  return {
    headings,
    openTasks,
    doneTasks,
    links,
  };
};

function FileTreeNode(props: {
  node: MarkdownTreeNode;
  level: number;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpenFile: (file: MarkdownFileNode) => void;
  onRenameFile: (file: MarkdownFileNode) => void;
  onDeleteFile: (file: MarkdownFileNode) => void;
}) {
  const paddingClass = () => {
    if (props.level >= 4) return "pl-10";
    if (props.level === 3) return "pl-8";
    if (props.level === 2) return "pl-6";
    return "pl-4";
  };

  if (props.node.kind === "file") {
    return (
      <div
        class={`sidebar-item group text-xs ${props.selectedPath === props.node.path ? "sidebar-item-active" : ""} ${paddingClass()}`}
        title={props.node.path}
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => props.onOpenFile(props.node as MarkdownFileNode)}
          onDblClick={(event) => {
            event.preventDefault();
            props.onRenameFile(props.node as MarkdownFileNode);
          }}
        >
          <i class="ti ti-file-type-md text-sm" />
          <span class="min-w-0 flex-1 truncate">{props.node.name}</span>
        </button>
        <button
          type="button"
          class="sidebar-item-action opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          aria-label={`Delete ${props.node.name}`}
          title="Delete file"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onDeleteFile(props.node as MarkdownFileNode);
          }}
        >
          <i class="ti ti-trash text-xs" />
        </button>
      </div>
    );
  }

  return (
    <>
      <AppWorkspace.SidebarItem
        icon={props.expanded.has(props.node.id) ? "ti ti-chevron-down" : "ti ti-chevron-right"}
        class={paddingClass()}
        onClick={() => props.onToggle(props.node.id)}
      >
        <span class="inline-flex min-w-0 items-center gap-1">
          <i class="ti ti-folder text-sm text-dimmed" />
          <span class="truncate">{props.node.name}</span>
        </span>
      </AppWorkspace.SidebarItem>
      <Show when={props.expanded.has(props.node.id)}>
        <For each={(props.node as MarkdownDirectoryNode).children}>
          {(child) => (
            <FileTreeNode
              node={child}
              level={props.level + 1}
              selectedPath={props.selectedPath}
              expanded={props.expanded}
              onToggle={props.onToggle}
              onOpenFile={props.onOpenFile}
              onRenameFile={props.onRenameFile}
              onDeleteFile={props.onDeleteFile}
            />
          )}
        </For>
      </Show>
    </>
  );
}

export function MarkdownEditorApp(props: Props) {
  const [workspace, setWorkspace] = createSignal<MarkdownWorkspace>(emptyWorkspace);
  const [selectedFile, setSelectedFile] = createSignal<MarkdownFileContent | null>(null);
  const [draft, setDraft] = createSignal("");
  const [draftCache, setDraftCache] = createSignal<Record<string, string>>({});
  const [savedMarkdown, setSavedMarkdown] = createSignal("");
  const [mode, setMode] = createSignal<Mode>("edit");
  const [expanded, setExpanded] = createSignal(new Set<string>());
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  const dirty = createMemo(() => draft() !== savedMarkdown());
  const previewHtml = createMemo(() => renderMarkdown(draft()));
  const selectedPath = createMemo(() => selectedFile()?.path ?? null);
  const allFiles = createMemo(() => workspace().folders.flatMap((folder) => flattenFiles(folder.tree)));
  const fileCount = createMemo(() => workspace().folders.reduce((total, folder) => total + folder.fileCount, 0));
  const wordCount = createMemo(() => draft().trim().split(/\s+/).filter(Boolean).length);
  const lineCount = createMemo(() => (draft() ? draft().split("\n").length : 0));
  const characterCount = createMemo(() => draft().length);
  const documentStats = createMemo(() => extractDocumentStats(draft()));
  const noteSizeData = createMemo(() =>
    allFiles()
      .slice()
      .sort((a, b) => b.size - a.size)
      .slice(0, 8)
      .map((file) => ({
        label: file.name.replace(/\.md$/i, "").slice(0, 14),
        value: file.size,
      })),
  );

  const expandWorkspace = (next: MarkdownWorkspace) => {
    setExpanded((current) => {
      const ids = new Set(current);
      for (const folder of next.folders) {
        ids.add(folder.id);
        collectDirectoryIds(folder.tree, ids);
      }
      return ids;
    });
  };

  const firstFile = (next: MarkdownWorkspace) => next.folders.flatMap((folder) => flattenFiles(folder.tree))[0] ?? null;

  const rememberCurrentDraft = () => {
    const file = selectedFile();
    if (!file) return;
    setDraftCache((current) => {
      const next = { ...current };
      if (dirty()) next[file.path] = draft();
      else delete next[file.path];
      return next;
    });
  };

  const openFile = async (file: MarkdownFileNode) => {
    if (selectedFile()?.path === file.path) return;
    rememberCurrentDraft();
    setLoading(true);
    try {
      const content = await readResult(props.bridge.readMarkdownFile({ path: file.path }));
      const cachedDraft = draftCache()[file.path];
      setSelectedFile(content);
      setDraft(cachedDraft ?? content.markdown);
      setSavedMarkdown(content.markdown);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspace = async () => {
    setLoading(true);
    try {
      const next = await readResult(props.bridge.getMarkdownWorkspace());
      setWorkspace(next);
      expandWorkspace(next);
      const file = findFile(next, next.lastFilePath) ?? firstFile(next);
      if (file && !selectedFile()) await openFile(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const refreshWorkspace = async () => {
    const next = await readResult(props.bridge.getMarkdownWorkspace());
    setWorkspace(next);
    expandWorkspace(next);
    return next;
  };

  const promptText = async (title: string, message: string, defaultValue: string) => {
    const result = await readResult(props.bridge.showNativeTextPrompt({ title, message, defaultValue }));
    const value = result.value?.trim();
    return value ? value : null;
  };

  const addFolder = async () => {
    setLoading(true);
    try {
      const next = await readResult(props.bridge.addMarkdownFolder());
      setWorkspace(next);
      expandWorkspace(next);
      const file = findFile(next, next.lastFilePath) ?? firstFile(next);
      if (file) await openFile(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const removeFolder = async (folder: MarkdownFolder) => {
    if (!confirm(`Remove "${folder.name}" from this app? Files stay on disk.`)) return;
    setLoading(true);
    try {
      const next = await readResult(props.bridge.removeMarkdownFolder({ id: folder.id }));
      setWorkspace(next);
      if (selectedFile()?.path.startsWith(folder.path)) {
        setSelectedFile(null);
        setDraft("");
        setSavedMarkdown("");
      }
      setDraftCache((current) => Object.fromEntries(Object.entries(current).filter(([path]) => !path.startsWith(folder.path))));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const createFile = async (folder: MarkdownFolder) => {
    try {
      const name = await promptText("New markdown file", `File name in ${folder.name}`, "Untitled.md");
      if (!name) return;
      const content = await readResult(props.bridge.createMarkdownFile({ folderId: folder.id, name }));
      await refreshWorkspace();
      setSelectedFile(content);
      setDraft(content.markdown);
      setSavedMarkdown(content.markdown);
      setDraftCache((current) => {
        const next = { ...current };
        delete next[content.path];
        return next;
      });
      toast.success("File created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const renameFile = async (file: MarkdownFileNode) => {
    try {
      const name = await promptText("Rename markdown file", "New file name", file.name);
      if (!name || name === file.name) return;
      const wasSelected = selectedFile()?.path === file.path;
      const currentDraft = draft();
      const wasDirty = dirty();
      const content = await readResult(props.bridge.renameMarkdownFile({ path: file.path, name }));
      await refreshWorkspace();
      setDraftCache((current) => {
        const next = { ...current };
        const cached = next[file.path];
        delete next[file.path];
        if (cached) next[content.path] = cached;
        if (wasSelected && wasDirty) next[content.path] = currentDraft;
        return next;
      });
      if (wasSelected) {
        setSelectedFile(content);
        setDraft(wasDirty ? currentDraft : content.markdown);
        setSavedMarkdown(content.markdown);
      }
      toast.success("File renamed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteFile = async (file: MarkdownFileNode) => {
    if (!confirm(`Delete "${file.name}" from disk?`)) return;
    try {
      const wasSelected = selectedFile()?.path === file.path;
      const next = await readResult(props.bridge.deleteMarkdownFile({ path: file.path }));
      setWorkspace(next);
      expandWorkspace(next);
      setDraftCache((current) => {
        const cache = { ...current };
        delete cache[file.path];
        return cache;
      });
      if (wasSelected) {
        const replacement = firstFile(next);
        setSelectedFile(null);
        setDraft("");
        setSavedMarkdown("");
        if (replacement) await openFile(replacement);
      }
      toast.success("File deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const openSelectedFileWindow = async () => {
    const file = selectedFile();
    if (!file) return;
    try {
      await desktop.window.open(<props.DocumentWindow filePath={file.path} fileName={file.name} />, {
        title: file.name,
        width: 920,
        height: 720,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const rescan = async () => {
    setLoading(true);
    try {
      const next = await readResult(props.bridge.rescanMarkdownFolders());
      setWorkspace(next);
      expandWorkspace(next);
      toast.success("Folders rescanned");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    const file = selectedFile();
    if (!file || !dirty()) return;
    setSaving(true);
    try {
      const content = await readResult(props.bridge.saveMarkdownFile({ path: file.path, markdown: draft() }));
      setSelectedFile(content);
      setDraft(content.markdown);
      setSavedMarkdown(content.markdown);
      setDraftCache((current) => {
        const next = { ...current };
        delete next[content.path];
        return next;
      });
      void rescan();
      toast.success("File saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  onMount(() => {
    void loadWorkspace();
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  createEffect(() => {
    if (!selectedFile() && workspace().lastFilePath) {
      const file = findFile(workspace(), workspace().lastFilePath);
      if (file) void openFile(file);
    }
  });

  return (
    <DesktopWorkspace storageKey="markdown-desk" topBarHeight={44}>
      <DesktopWorkspace.Sidebar defaultSize={280} minSize={220} maxSize={430} resizable railAt={180} restoreSize={280}>
        <div class="flex h-full min-h-0 flex-col gap-4 p-3 pt-0">
          <AppWorkspace.SidebarBody scrollPreserveKey="markdown-desk-sidebar">
            <AppWorkspace.SidebarSection title="Folders">
              <Show
                when={workspace().folders.length > 0}
                fallback={
                  <div class="px-2 py-8 text-center text-xs text-dimmed">
                    <i class="ti ti-folder-plus mb-2 block text-lg" />
                    Add a local folder.
                  </div>
                }
              >
                <For each={workspace().folders}>
                  {(folder) => (
                    <>
                      <div class="sidebar-item group text-xs" title={folder.path}>
                        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(folder.id)}>
                          <i class={`${expanded().has(folder.id) ? "ti ti-chevron-down" : "ti ti-chevron-right"} text-sm`} />
                          <span class="inline-flex min-w-0 items-center gap-1">
                            <i class="ti ti-folder text-sm text-dimmed" />
                            <span class="truncate">{folder.name}</span>
                          </span>
                        </button>
                        <span class="shrink-0 text-dimmed tabular-nums">{folder.fileCount}</span>
                        <span class="ml-auto inline-flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            class="sidebar-item-action"
                            aria-label={`New file in ${folder.name}`}
                            title="New file"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void createFile(folder);
                            }}
                          >
                            <i class="ti ti-plus text-xs" />
                          </button>
                          <button
                            type="button"
                            class="sidebar-item-action"
                            aria-label={`Remove ${folder.name}`}
                            title="Remove folder"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void removeFolder(folder);
                            }}
                          >
                            <i class="ti ti-x text-xs" />
                          </button>
                        </span>
                      </div>
                      <Show when={expanded().has(folder.id)}>
                        <For each={folder.tree}>
                          {(node) => (
                            <FileTreeNode
                              node={node}
                              level={1}
                              selectedPath={selectedPath()}
                              expanded={expanded()}
                              onToggle={toggle}
                              onOpenFile={(file) => void openFile(file)}
                              onRenameFile={(file) => void renameFile(file)}
                              onDeleteFile={(file) => void deleteFile(file)}
                            />
                          )}
                        </For>
                      </Show>
                    </>
                  )}
                </For>
              </Show>
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarBody>
          <AppWorkspace.SidebarFooter>
            <AppWorkspace.SidebarItem icon="ti ti-folder-plus" onClick={() => void addFolder()} disabled={loading()}>
              Add folder
            </AppWorkspace.SidebarItem>
            <AppWorkspace.SidebarItem
              icon={loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"}
              onClick={() => void rescan()}
              disabled={loading()}
            >
              Rescan
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarFooter>
        </div>
      </DesktopWorkspace.Sidebar>

      <DesktopWorkspace.SidebarRail size={48} class="rounded-tr-xl">
        <nav class="flex h-full min-h-0 flex-col items-center gap-2 rounded-tr-xl bg-white py-3 dark:bg-zinc-950">
          <button
            type="button"
            class="desktop-panel-toggle"
            aria-label="Open folders"
            title="Open folders"
            onClick={() => desktopWorkspace.panel("left").open()}
          >
            <i class="ti ti-folder" />
          </button>
          <button
            type="button"
            class="desktop-panel-toggle"
            aria-label="Toggle detail panel"
            title="Toggle detail panel"
            onClick={() => desktopWorkspace.panel("right").toggle()}
          >
            <i class="ti ti-layout-sidebar-right" />
          </button>
          <button
            type="button"
            class="desktop-panel-toggle"
            aria-label="Toggle bottom panel"
            title="Toggle bottom panel"
            onClick={() => desktopWorkspace.panel("bottom").toggle()}
          >
            <i class="ti ti-layout-bottombar" />
          </button>
          <button
            type="button"
            class="desktop-panel-toggle mt-auto"
            aria-label="Hide folder rail"
            title="Hide folder rail"
            onClick={() => desktopWorkspace.panel("left").hide()}
          >
            <i class="ti ti-chevron-left" />
          </button>
        </nav>
      </DesktopWorkspace.SidebarRail>

      <DesktopWorkspace.TopBar drag>
        <div class="flex h-full min-w-0 items-center gap-3 px-3 pr-1">
          <p class="min-w-0 translate-y-px truncate text-sm font-semibold leading-none text-primary">Markdown Desk</p>
          <DesktopWorkspace.NoDrag class="ml-auto flex items-center gap-2">
            <SegmentedControl<Mode>
              options={[
                { value: "edit", label: "Edit", icon: "ti ti-pencil" },
                { value: "preview", label: "Preview", icon: "ti ti-eye" },
              ]}
              value={mode}
              onChange={setMode}
              disabled={!selectedFile()}
            />
            <button type="button" class="btn-segment shrink-0" disabled={!dirty() || saving()} onClick={() => void save()}>
              <i class={saving() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
              Save
            </button>
            <span class="ml-2 flex items-center gap-1">
              <button
                type="button"
                class="desktop-panel-toggle"
                aria-label="Toggle detail panel"
                style="-webkit-app-region:no-drag"
                title="Toggle detail panel"
                onClick={() => desktopWorkspace.panel("right").toggle()}
              >
                <i class="ti ti-layout-sidebar-right" />
              </button>
              <button
                type="button"
                class="desktop-panel-toggle"
                aria-label="Toggle bottom panel"
                style="-webkit-app-region:no-drag"
                title="Toggle bottom panel"
                onClick={() => desktopWorkspace.panel("bottom").toggle()}
              >
                <i class="ti ti-layout-bottombar" />
              </button>
            </span>
          </DesktopWorkspace.NoDrag>
        </div>
      </DesktopWorkspace.TopBar>

      <DesktopWorkspace.Main>
        <main class="flex h-full min-h-0 flex-col">
          <Show
            when={selectedFile()}
            fallback={
              <section class="paper flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                <i class="ti ti-file-type-md text-2xl text-dimmed" />
                <h2 class="text-sm font-semibold text-primary">No markdown file selected</h2>
                <p class="max-w-sm text-xs text-dimmed">
                  Add one or more local folders in the sidebar. Files stay on disk; folder state is local SQLite.
                </p>
              </section>
            }
          >
            <section class="min-h-0 flex-1 overflow-hidden">
              <Show
                when={mode() === "edit"}
                fallback={<MarkdownView html={previewHtml()} class="markdown-preview-pane h-full overflow-auto" />}
              >
                <div class="markdown-editor-pane h-full min-h-0">
                  <MarkdownEditor value={draft} onInput={setDraft} lines={26} placeholder="Write markdown..." variant="paper" />
                </div>
              </Show>
            </section>
          </Show>
        </main>
      </DesktopWorkspace.Main>

      <DesktopWorkspace.Right defaultSize={330} minSize={260} maxSize={540} resizable railAt={220} restoreSize={330}>
        <div class="flex h-full min-h-0 flex-col gap-2 overflow-auto">
          <section class="paper p-3">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Document</h2>
              <Show when={dirty()}>
                <span class="tag bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">unsaved</span>
              </Show>
            </div>
            <button
              type="button"
              class="btn-secondary btn-sm mt-3 w-full justify-start"
              disabled={!selectedFile()}
              onClick={() => void openSelectedFileWindow()}
            >
              <i class="ti ti-window" />
              Open in window
            </button>
            <dl class="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt class="text-dimmed">Words</dt>
                <dd class="mt-0.5 font-medium text-primary">{wordCount()}</dd>
              </div>
              <div>
                <dt class="text-dimmed">Size</dt>
                <dd class="mt-0.5 font-medium text-primary">{selectedFile() ? formatBytes(selectedFile()!.size) : "-"}</dd>
              </div>
              <div class="col-span-2">
                <dt class="text-dimmed">Modified</dt>
                <dd class="mt-0.5 font-medium text-primary">{selectedFile() ? formatTime(selectedFile()!.updatedAt) : "-"}</dd>
              </div>
            </dl>
          </section>
          <section class="paper min-h-0 p-3">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-dimmed">Path</h2>
            <p class="mt-3 break-all text-xs text-primary">{selectedFile()?.path ?? "No file selected."}</p>
          </section>
          <section class="paper p-3">
            <div class="flex items-start gap-2 text-xs text-dimmed">
              <i class="ti ti-database mt-0.5 text-sm" />
              <p>Folders and the last opened file are local SQLite data. Markdown content is read from and saved to the original files.</p>
            </div>
          </section>
        </div>
      </DesktopWorkspace.Right>

      <DesktopWorkspace.RightRail size={54}>
        <nav class="paper flex h-full min-h-0 flex-col items-center gap-2 p-2">
          <button
            type="button"
            class="desktop-panel-toggle"
            aria-label="Open document details"
            title="Open document details"
            onClick={() => desktopWorkspace.panel("right").open()}
          >
            <i class="ti ti-file-info" />
          </button>
          <button
            type="button"
            class="desktop-panel-toggle"
            aria-label="Show document path"
            title="Show document path"
            onClick={() => desktopWorkspace.panel("right").open()}
          >
            <i class="ti ti-route" />
          </button>
          <button
            type="button"
            class="desktop-panel-toggle mt-auto"
            aria-label="Hide detail rail"
            title="Hide detail rail"
            onClick={() => desktopWorkspace.panel("right").hide()}
          >
            <i class="ti ti-chevron-right" />
          </button>
        </nav>
      </DesktopWorkspace.RightRail>

      <DesktopWorkspace.Bottom defaultSize={180} minSize={140} maxSize={360} resizable railAt={96} restoreSize={180}>
        <section class="markdown-bottom-analytics paper h-full min-h-0 overflow-hidden">
          <div class="grid h-full min-h-0 grid-cols-[1.2fr_1.8fr]">
            <div class="flex min-h-0 flex-col gap-2 p-3">
              <div class="flex items-center justify-between gap-2">
                <h2 class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">Note size distribution</h2>
                <span class="tag bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  <i class="ti ti-chart-bar" />
                  {fileCount()} notes
                </span>
              </div>
              <Show
                when={fileCount() > 4}
                fallback={
                  <div class="flex min-h-0 flex-1 items-center justify-center rounded bg-zinc-50 px-3 text-center text-xs text-dimmed dark:bg-zinc-950">
                    Add five or more markdown files to compare character counts.
                  </div>
                }
              >
                <Chart kind="bar" class="min-h-0 flex-1 text-dimmed" data={noteSizeData()} showValues />
              </Show>
            </div>
            <div class="markdown-bottom-stats grid min-h-0 grid-cols-2 gap-px bg-zinc-100 dark:bg-zinc-800">
              <StatCell label="Characters" value={characterCount()} sub={`${lineCount()} lines`} />
              <StatCell
                label="Headings"
                value={documentStats().headings}
                sub="current file"
                accent={{ tone: "blue", icon: "ti ti-list" }}
              />
              <StatCell
                label="Tasks"
                value={documentStats().openTasks}
                sub={`${documentStats().doneTasks} done`}
                accent={{
                  tone: documentStats().openTasks ? "amber" : "emerald",
                  icon: documentStats().openTasks ? "ti ti-square" : "ti ti-square-check",
                  text: documentStats().openTasks ? "open" : "clear",
                }}
              />
              <StatCell label="Links" value={documentStats().links} sub="markdown links" accent={{ tone: "zinc", icon: "ti ti-link" }} />
            </div>
          </div>
        </section>
      </DesktopWorkspace.Bottom>

      <DesktopWorkspace.BottomRail size={42}>
        <section class="paper flex h-full min-h-0 items-center gap-3 px-3 text-xs text-dimmed">
          <button
            type="button"
            class="desktop-panel-toggle"
            aria-label="Open analytics"
            title="Open analytics"
            onClick={() => desktopWorkspace.panel("bottom").open()}
          >
            <i class="ti ti-chart-bar" />
          </button>
          <span class="tabular-nums">{fileCount()} notes</span>
          <span class="tabular-nums">{wordCount()} words</span>
          <button
            type="button"
            class="desktop-panel-toggle ml-auto"
            aria-label="Hide analytics rail"
            title="Hide analytics rail"
            onClick={() => desktopWorkspace.panel("bottom").hide()}
          >
            <i class="ti ti-chevron-down" />
          </button>
        </section>
      </DesktopWorkspace.BottomRail>
    </DesktopWorkspace>
  );
}
