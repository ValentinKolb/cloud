/**
 * FileBrowser — FileTree + FileView over a FileSource adapter. One dialog
 * serves every file surface (conversation VFS, skills, later the Files app):
 * the source decides the capabilities, optional methods enable the matching
 * UI (write → edit/save, remove → delete, rename → rename, upload → upload).
 * Fixed-height IDE-style layout: both panes scroll, the shell never jumps.
 */
import { createZip, downloadFileFromContent } from "@valentinkolb/stdlib/browser";
import { createResource, createSignal, Show } from "solid-js";
import { dialogCore } from "../dialog-core";
import { prompts } from "../prompts";
import Dropdown from "./Dropdown";
import FileTree, { type FileTreeEntry } from "./FileTree";
import FileView, { type FileViewContent } from "./FileView";
import PanelDialog, { panelDialogOptions } from "./PanelDialog";
import Placeholder from "./Placeholder";

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
  /** Preselect a file once entries are loaded. */
  initialPath?: string;
  /** Fixed shell height — the panes scroll inside it. */
  class?: string;
};

const parentOf = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
};

export function FileBrowserPanel(props: FileBrowserPanelProps) {
  const [entries, { refetch }] = createResource(async () => props.source.list());
  const [selectedPath, setSelectedPath] = createSignal<string | null>(props.initialPath ?? null);
  // Folders exist implicitly through file paths — freshly created (still empty)
  // ones live here until their first file makes them real.
  const [pendingFolders, setPendingFolders] = createSignal<string[]>([]);
  let uploadInputRef: HTMLInputElement | undefined;
  let uploadDir = "/";

  const allEntries = (): FileTreeEntry[] => {
    const loaded = entries() ?? [];
    const real = new Set(loaded.map((entry) => entry.path));
    return [...loaded, ...pendingFolders().filter((path) => !real.has(path)).map((path) => ({ path, kind: "folder" as const }))];
  };
  const selectedEntry = () => allEntries().find((entry) => entry.path === selectedPath()) ?? null;
  const pathWritable = (path: string) => Boolean(props.source.write) && !props.source.isReadOnly?.(path);

  const run = async (work: () => Promise<void>) => {
    try {
      await work();
      await refetch();
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "File operation failed");
    }
  };

  const removeFile = (path: string) =>
    void (async () => {
      const confirmed = await prompts.confirm(`Delete ${path}?`, { title: "Delete file", variant: "danger" });
      if (!confirmed) return;
      await run(async () => {
        await props.source.remove!(path);
        if (selectedPath() === path) setSelectedPath(null);
      });
    })();

  const renameFile = (path: string, nextName: string) =>
    void run(async () => {
      const target = `${parentOf(path) === "/" ? "" : parentOf(path)}/${nextName}`;
      await props.source.rename!(path, target);
      if (selectedPath() === path) setSelectedPath(target);
    });

  const createFile = (dirPath: string) =>
    void (async () => {
      const name = await prompts.prompt("Name of the new file:", "", { title: "New file" });
      if (!name || typeof name !== "string" || !name.trim() || name.includes("/")) return;
      const path = `${dirPath === "/" ? "" : dirPath}/${name.trim()}`;
      await run(async () => {
        await props.source.write!(path, "");
        setSelectedPath(path);
      });
    })();

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

  const onUploadPicked = (files: FileList | null) =>
    void (async () => {
      if (!files?.length) return;
      await run(() => props.source.upload!(uploadDir, Array.from(files)));
    })();

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
    void run(async () => {
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
    ...(props.source.rename ? { rename: (path: string, next: string) => (pathWritable(path) ? renameFile(path, next) : undefined) } : {}),
    ...(props.source.remove ? { remove: (path: string) => (pathWritable(path) ? removeFile(path) : undefined) } : {}),
    ...(props.source.write ? { createFile: (dir: string) => (pathWritable(dir) ? createFile(dir) : undefined) } : {}),
    ...(props.source.write ? { createFolder: (dir: string) => (pathWritable(dir) ? createFolder(dir) : undefined) } : {}),
    ...(props.source.rename
      ? { move: (path: string, dir: string) => (pathWritable(path) && pathWritable(dir) ? moveEntry(path, dir) : undefined) }
      : {}),
    download: (path: string, isFolder: boolean) => downloadEntry(path, isFolder),
  });

  const addMenuItems = () => [
    ...(props.source.write ? [{ icon: "ti ti-file-plus", label: "New file", action: () => createFile("/") }] : []),
    ...(props.source.write ? [{ icon: "ti ti-folder-plus", label: "New folder", action: () => createFolder("/") }] : []),
    ...(props.source.upload ? [{ icon: "ti ti-upload", label: "Upload files", action: () => pickUpload("/") }] : []),
  ];

  return (
    <div class={`grid min-h-0 grid-cols-[minmax(11rem,15rem)_1fr] gap-3 ${props.class ?? "h-[min(60vh,34rem)]"}`}>
      <div class="flex min-h-0 min-w-0 flex-col gap-1">
        <div class="flex items-center justify-between pl-1.5">
          <p class="text-[10px] font-medium uppercase tracking-wide text-dimmed">Files</p>
          <Show when={addMenuItems().length > 0}>
            <Dropdown
              position="bottom-left"
              elements={addMenuItems()}
              trigger={
                <span
                  class="inline-flex h-6 w-6 items-center justify-center rounded-md text-dimmed transition-colors hover:bg-zinc-200/70 hover:text-primary dark:hover:bg-zinc-800"
                  title="Add"
                >
                  <i class="ti ti-plus text-sm" aria-hidden="true" />
                  <span class="sr-only">Add file, folder, or upload</span>
                </span>
              }
            />
          </Show>
        </div>
        <Show
          when={allEntries().length > 0}
          fallback={<Placeholder icon="ti ti-folder-open" title="No files" description="This space is empty." />}
        >
          <FileTree
            class="min-h-0 flex-1 overflow-y-auto"
            entries={allEntries()}
            selectedPath={selectedPath()}
            onSelect={(entry) => setSelectedPath(entry.path)}
            actions={treeActions()}
          />
        </Show>
        <input ref={uploadInputRef} type="file" multiple class="hidden" onChange={(event) => onUploadPicked(event.currentTarget.files)} />
      </div>

      <Show
        when={selectedEntry()}
        fallback={<Placeholder icon="ti ti-file" title="Select a file" description="Pick a file from the tree to view it." />}
      >
        {(entry) => (
          <FileView
            file={{ path: entry().path, mediaType: entry().mediaType, size: entry().size }}
            load={() => props.source.read(entry().path)}
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
      </Show>
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
