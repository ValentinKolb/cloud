/**
 * FileBrowser — FileTree + FileView over a FileSource adapter. One dialog
 * serves every file surface (conversation VFS, skills, later the Files app):
 * the source decides the capabilities, optional methods enable the matching
 * UI (write → edit/save, remove → delete, rename → rename, upload → upload).
 * Fixed-height IDE-style layout: both panes scroll, the shell never jumps.
 */
import { createZip, downloadFileFromContent } from "@k2b/stdlib/browser";
import { mutation } from "@k2b/stdlib/solid";
import { createEffect, createMemo, createResource, createSignal, Match, Show, Switch, untrack } from "solid-js";
import { dialogCore } from "../feedback/dialog-core";
import { prompts } from "../feedback/prompts";
import Dropdown from "../actions/Dropdown";
import FileTree, { type FileTreeEntry } from "./FileTree";
import FileView, { type FileViewContent, type FileViewRenderer } from "./FileView";
import PanelDialog, { panelDialogOptions } from "../layout/PanelDialog";
import Placeholder from "../surfaces/Placeholder";

export type FileSource = {
  list(): Promise<FileTreeEntry[]>;
  read(path: string): Promise<FileViewContent>;
  write?(path: string, content: string, encoding?: "utf8" | "base64"): Promise<void>;
  remove?(path: string): Promise<void>;
  rename?(from: string, to: string): Promise<void>;
  upload?(dirPath: string, files: File[]): Promise<void>;
  downloadHref?(path: string): string | null;
  /** Paths matching this predicate stay read-only even when the source can write (e.g. /input). */
  isReadOnly?(path: string): boolean;
};

export type FileBrowserPanelProps = {
  source: FileSource;
  /** Hide every mutating affordance while retaining file selection and downloads. */
  readOnly?: boolean;
  /** Refetch entries when this host-controlled value changes. */
  refreshKey?: unknown;
  /** Preselect a file once entries are loaded. */
  initialPath?: string;
  /** Mirrors file selection into route state when the host needs durable navigation. */
  onSelectedPathChange?: (path: string | null) => void;
  /** Per-instance preview extensions forwarded to FileView. */
  renderers?: readonly FileViewRenderer[];
  /** Optional host copy/policy for leaving an unsaved file. */
  confirmDiscard?: (path: string, nextPath: string | null) => boolean | Promise<boolean>;
  /** Fixed shell height — the panes scroll inside it. */
  class?: string;
};

const parentOf = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
};

export function FileBrowserPanel(props: FileBrowserPanelProps) {
  // FileSource is an imperative adapter. Its methods may read host signals,
  // but refreshes stay owned by this component (`refetch` / `refreshKey`);
  // tracking those implementation details can otherwise feed a write back
  // into its own list request indefinitely.
  const [entries, { refetch }] = createResource(async () => untrack(() => props.source.list()));
  const [selectedPath, setSelectedPath] = createSignal<string | null>(props.initialPath ?? null);
  const [selectedDirty, setSelectedDirty] = createSignal(false);
  // Folders exist implicitly through file paths — freshly created (still empty)
  // ones live here until their first file makes them real.
  const [pendingFolders, setPendingFolders] = createSignal<string[]>([]);
  let uploadInputRef: HTMLInputElement | undefined;
  let uploadDir = "/";
  let previousRefreshKey = props.refreshKey;

  createEffect(() => {
    const next = props.initialPath ?? null;
    if (!selectedDirty() && next !== selectedPath()) setSelectedPath(next);
  });
  createEffect(() => props.onSelectedPathChange?.(selectedPath()));
  createEffect(() => {
    const refreshKey = props.refreshKey;
    if (Object.is(refreshKey, previousRefreshKey)) return;
    previousRefreshKey = refreshKey;
    void refetch();
  });

  const allEntries = createMemo<FileTreeEntry[]>(() => {
    const loaded = entries() ?? [];
    const real = new Set(loaded.map((entry) => entry.path));
    return [
      ...loaded,
      ...pendingFolders()
        .filter((path) => !real.has(path))
        .map((path) => ({ path, kind: "folder" as const })),
    ];
  });
  const selectedEntry = createMemo(() => allEntries().find((entry) => entry.path === selectedPath()) ?? null);
  const fileMutation = mutation.create<void, () => Promise<void>>({
    mutation: (work) => work(),
    onSuccess: () => void refetch(),
    onError: (error) => void prompts.error(error.message),
  });
  const pathMutable = (path: string) => !fileMutation.loading() && !props.readOnly && !props.source.isReadOnly?.(path);
  const pathWritable = (path: string) => pathMutable(path) && Boolean(props.source.write);
  const run = (work: () => Promise<void>) => void fileMutation.mutate(work);
  const canLeaveCurrent = async (nextPath: string | null): Promise<boolean> => {
    const current = selectedPath();
    if (nextPath === current || !selectedDirty() || !current) return true;
    if (selectedDirty() && current) {
      const confirmed = props.confirmDiscard
        ? await props.confirmDiscard(current, nextPath)
        : await prompts.confirm("Discard the unsaved changes in this file?", {
            title: "Discard changes",
            variant: "danger",
          });
      if (!confirmed) return false;
    }
    return true;
  };
  const selectPath = async (nextPath: string | null) => {
    if (!(await canLeaveCurrent(nextPath))) return;
    setSelectedDirty(false);
    setSelectedPath(nextPath);
  };

  const removeFile = (path: string) =>
    run(async () => {
      const confirmed = await prompts.confirm(`Delete ${path}?`, { title: "Delete file", variant: "danger" });
      if (!confirmed) return;
      await props.source.remove!(path);
      setPendingFolders((folders) => folders.filter((candidate) => candidate !== path && !candidate.startsWith(`${path}/`)));
      const selected = selectedPath();
      if (selected === path || selected?.startsWith(`${path}/`)) setSelectedPath(null);
    });

  const renameFile = (path: string, nextName: string) =>
    run(async () => {
      const target = `${parentOf(path) === "/" ? "" : parentOf(path)}/${nextName}`;
      await props.source.rename!(path, target);
      if (selectedPath() === path) setSelectedPath(target);
    });

  const createFile = (dirPath: string) =>
    run(async () => {
      const name = await prompts.prompt("Name of the new file:", "", { title: "New file" });
      if (!name || typeof name !== "string" || !name.trim() || name.includes("/")) return;
      const path = `${dirPath === "/" ? "" : dirPath}/${name.trim()}`;
      if (!(await canLeaveCurrent(path))) return;
      await props.source.write!(path, "");
      setSelectedDirty(false);
      setSelectedPath(path);
    });

  const createFolder = (dirPath: string) =>
    void (async () => {
      const name = await prompts.prompt("Name of the new folder:", "", { title: "New folder" });
      if (!name || typeof name !== "string" || !name.trim() || name.includes("/")) return;
      const path = `${dirPath === "/" ? "" : dirPath}/${name.trim()}`;
      setPendingFolders((folders) => [...folders, path]);
    })();

  const pickUpload = (dirPath: string) => {
    uploadDir = dirPath;
    uploadInputRef?.click();
  };

  const onUploadPicked = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) run(() => props.source.upload!(uploadDir, files));
  };

  const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

  /** Concrete file paths behind an entry: the file itself, or everything under a folder. */
  const filesBehind = (path: string): string[] => {
    const list = entries() ?? [];
    if (list.some((entry) => entry.path === path && entry.kind !== "folder")) return [path];
    const prefix = `${path}/`;
    return list.filter((entry) => entry.path.startsWith(prefix) && entry.kind !== "folder").map((entry) => entry.path);
  };

  /** Move a file OR a whole folder subtree (per-file renames preserve the structure). */
  const moveEntry = (path: string, targetDir: string) =>
    run(async () => {
      const destBase = `${targetDir === "/" ? "" : targetDir}/${baseName(path)}`;
      const files = filesBehind(path);
      if (files.length === 0) {
        // Still-empty pending folder — relocating it is a purely local affair.
        setPendingFolders((folders) => folders.map((candidate) => (candidate === path ? destBase : candidate)));
        return;
      }
      for (const file of files) {
        await props.source.rename!(file, `${destBase}${file.slice(path.length)}`);
      }
      const selected = selectedPath();
      if (selected && (selected === path || selected.startsWith(`${path}/`))) {
        setSelectedPath(`${destBase}${selected.slice(path.length)}`);
      }
    });

  const contentBytes = async (path: string): Promise<Uint8Array> => {
    const content = await props.source.read(path);
    return content.encoding === "utf8"
      ? new TextEncoder().encode(content.content)
      : Uint8Array.from(atob(content.content), (char) => char.charCodeAt(0));
  };

  const downloadEntry = (path: string, isFolder: boolean) =>
    void (async () => {
      try {
        if (!isFolder) {
          const href = props.source.downloadHref?.(path);
          if (href) {
            const anchor = document.createElement("a");
            anchor.href = href;
            anchor.download = baseName(path);
            anchor.click();
            return;
          }
          const content = await props.source.read(path);
          downloadFileFromContent(await contentBytes(path), baseName(path), content.mediaType || "application/octet-stream");
          return;
        }
        const files = filesBehind(path);
        if (files.length === 0) throw new Error("This folder is empty.");
        const zipEntries = await Promise.all(
          files.map(async (file) => ({ filename: file.slice(path.length + 1), source: await contentBytes(file) })),
        );
        downloadFileFromContent(await createZip(zipEntries), `${baseName(path) || "files"}.zip`, "application/zip");
      } catch (error) {
        void prompts.error(error instanceof Error ? error.message : "Download failed");
      }
    })();

  const treeActions = () => ({
    ...(!props.readOnly && props.source.rename
      ? { rename: (path: string, next: string) => (pathMutable(path) ? renameFile(path, next) : undefined) }
      : {}),
    ...(!props.readOnly && props.source.remove ? { remove: (path: string) => (pathMutable(path) ? removeFile(path) : undefined) } : {}),
    ...(!props.readOnly && props.source.write ? { createFile: (dir: string) => (pathWritable(dir) ? createFile(dir) : undefined) } : {}),
    ...(!props.readOnly && props.source.write
      ? { createFolder: (dir: string) => (pathWritable(dir) ? createFolder(dir) : undefined) }
      : {}),
    ...(!props.readOnly && props.source.rename
      ? { move: (path: string, dir: string) => (pathMutable(path) && pathMutable(dir) ? moveEntry(path, dir) : undefined) }
      : {}),
    download: (path: string, isFolder: boolean) => downloadEntry(path, isFolder),
  });

  const addMenuItems = () => [
    ...(pathWritable("/") ? [{ icon: "ti ti-file-plus", label: "New file", action: () => createFile("/") }] : []),
    ...(pathWritable("/") ? [{ icon: "ti ti-folder-plus", label: "New folder", action: () => createFolder("/") }] : []),
    ...(pathMutable("/") && props.source.upload ? [{ icon: "ti ti-upload", label: "Upload files", action: () => pickUpload("/") }] : []),
  ];

  return (
    <div class={`k2b-content-file-browser ${props.class ?? ""}`} data-default-height={props.class ? undefined : "true"}>
      <div class="k2b-content-file-browser__sidebar">
        <div class="k2b-content-file-browser__header">
          <p class="k2b-content-file-browser__title">Files</p>
          <Show when={addMenuItems().length > 0}>
            <Dropdown.Root position="bottom-left" items={addMenuItems()} label="Add file, folder, or upload">
              <Dropdown.Trigger appearance="plain" class="k2b-content-file-browser__add" label="Add file, folder, or upload" title="Add">
                <i class="ti ti-plus" aria-hidden="true" />
                <span class="k2b-sr-only">Add file, folder, or upload</span>
              </Dropdown.Trigger>
            </Dropdown.Root>
          </Show>
        </div>
        <Switch>
          <Match when={entries.loading}>
            <Placeholder icon="ti ti-loader-2" title="Loading files…" />
          </Match>
          <Match when={entries.error}>
            <Placeholder
              icon="ti ti-alert-circle"
              title="Failed to load files"
              description={String(entries.error?.message ?? entries.error ?? "")}
            />
          </Match>
          <Match when={allEntries().length > 0}>
            <FileTree
              class="k2b-content-file-browser__tree"
              entries={allEntries()}
              selectedPath={selectedPath()}
              onSelect={(entry) => void selectPath(entry.path)}
              actions={treeActions()}
            />
          </Match>
          <Match when={true}>
            <Placeholder icon="ti ti-folder-open" title="No files" description="This space is empty." />
          </Match>
        </Switch>
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          class="k2b-content-file-browser__upload"
          onChange={(event) => onUploadPicked(event.currentTarget)}
        />
      </div>

      <Switch fallback={<Placeholder icon="ti ti-file" title="Select a file" description="Pick a file from the tree to view it." />}>
        <Match when={selectedEntry()?.kind === "folder"}>
          <Placeholder icon="ti ti-folder" title="Folder selected" description="Choose a file to preview it." />
        </Match>
        <Match when={selectedEntry()}>
          {(entry) => (
            <FileView
              file={{ path: entry().path, mediaType: entry().mediaType, size: entry().size }}
              load={() => props.source.read(entry().path)}
              revision={props.refreshKey}
              renderers={props.renderers}
              onDirtyChange={setSelectedDirty}
              save={
                pathWritable(entry().path)
                  ? async (content) => {
                      await props.source.write!(entry().path, content);
                      await refetch();
                    }
                  : undefined
              }
              downloadHref={props.source.downloadHref?.(entry().path) ?? null}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}

/** Open the file browser as a dialog. Returns when the dialog closes. */
export const openFileBrowser = (options: { source: FileSource; title?: string; subtitle?: string; icon?: string }): Promise<void> =>
  dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header
          title={options.title ?? "Files"}
          subtitle={options.subtitle}
          icon={options.icon ?? "ti ti-folder"}
          close={() => close()}
        />
        <PanelDialog.Body>
          <FileBrowserPanel source={options.source} />
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );
