import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { FileInfo, FileBaseInfo } from "@/files/contracts";
import { dates, fileIcons } from "@valentinkolb/cloud/lib/shared";
import { formatBytes } from "@valentinkolb/filegate/utils";
import {
  fileApiUrl,
  setDetailFileInUrl,
  DETAIL_FILE_SELECT_EVENT,
  type DetailFileSelectPayload,
} from "./context";
import {
  buildFileMenuElements,
  canOpenFileInline,
  type FileActionContext,
} from "./FileActions";

type FileDetailPanelProps = {
  initialFile: FileInfo | null;
  initialFilePath: string | null;
  initialBaseType: string;
  initialBaseId: string;
  items: FileInfo[];
  bases: FileBaseInfo[];
  useFullDetailKey?: boolean;
  showEmpty?: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  image: "Image",
  pdf: "PDF Document",
  video: "Video",
  audio: "Audio",
  text: "Text File",
  code: "Source Code",
  document: "Document",
  archive: "Archive",
  other: "File",
};

type FileActionEntry = Extract<ReturnType<typeof buildFileMenuElements>[number], { label: string }>;

const asFileBaseType = (value: string): FileBaseInfo["type"] => (value === "group" ? "group" : "home");

const isActionEntry = (entry: ReturnType<typeof buildFileMenuElements>[number]): entry is FileActionEntry => "label" in entry;

const parseFullDetailKey = (key: string) => {
  const firstColon = key.indexOf(":");
  const secondColon = key.indexOf(":", firstColon + 1);
  if (firstColon > 0 && secondColon > firstColon) {
    return {
      baseType: key.substring(0, firstColon),
      baseId: key.substring(firstColon + 1, secondColon),
      path: key.substring(secondColon + 1),
    };
  }
  return null;
};

export default function FileDetailPanel(props: FileDetailPanelProps) {
  const [file, setFile] = createSignal<FileInfo | null>(props.initialFile);
  const [filePath, setFilePath] = createSignal<string | null>(props.initialFilePath);
  const [baseType, setBaseType] = createSignal(props.initialBaseType);
  const [baseId, setBaseId] = createSignal(props.initialBaseId);

  onMount(() => {
    const handleSelect = (e: Event) => {
      const payload = (e as CustomEvent<DetailFileSelectPayload>).detail;
      setFile(payload.item);
      setFilePath(payload.itemKey);
      setBaseType(payload.baseType);
      setBaseId(payload.baseId);
    };

    const handlePopState = () => {
      const url = new URL(window.location.href);
      const key = url.searchParams.get("file");
      if (!key) {
        setFile(null);
        setFilePath(null);
        return;
      }

      if (props.useFullDetailKey) {
        const parsed = parseFullDetailKey(key);
        if (!parsed) return;
        const found = props.items.find((item) => item.path === parsed.path);
        setFile(found ?? null);
        setFilePath(key);
        setBaseType(parsed.baseType);
        setBaseId(parsed.baseId);
        return;
      }

      const found = props.items.find((item) => {
        const itemPath = item.path || `${props.initialBaseType}/${props.initialBaseId}/${item.name}`;
        return itemPath === key || item.name === key.split("/").pop();
      });
      setFile(found ?? null);
      setFilePath(key);
    };

    window.addEventListener(DETAIL_FILE_SELECT_EVENT, handleSelect);
    window.addEventListener("popstate", handlePopState);
    onCleanup(() => {
      window.removeEventListener(DETAIL_FILE_SELECT_EVENT, handleSelect);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  const isDirectory = () => file()?.type === "directory";
  const category = () => (file() ? fileIcons.getFileCategory(file()!) : "other");
  const icon = () => (file() ? fileIcons.getFileIcon(file()!) : "ti-file");

  const itemPath = () => {
    const currentPath = filePath();
    if (!currentPath) return "";
    if (props.useFullDetailKey) {
      const parsed = parseFullDetailKey(currentPath);
      return parsed?.path ?? currentPath;
    }
    return currentPath;
  };

  const contentUrl = () => `${fileApiUrl(baseType(), baseId())}/content?path=${encodeURIComponent(itemPath())}`;
  const actionContext = createMemo<FileActionContext>(() => ({
    baseType: asFileBaseType(baseType()),
    baseId: baseId(),
    bases: props.bases,
  }));

  const handleClose = () => setDetailFileInUrl(null);

  const fullPath = () => {
    const baseName = baseType() === "home" ? "~" : baseId();
    const path = itemPath();
    return `${baseName}${path.startsWith("/") ? "" : "/"}${path}`;
  };

  const detailFacts = () => {
    const currentFile = file();
    if (!currentFile) return [];
    return [
      { label: "Filename", value: currentFile.name, mono: false },
      { label: "Kind", value: isDirectory() ? "Folder" : CATEGORY_LABELS[category()] || "File" },
      { label: "Updated", value: dates.formatDateTime(currentFile.mtime) },
      { label: "Size", value: isDirectory() ? "Folder" : formatBytes({ bytes: currentFile.size }) },
      { label: "Path", value: fullPath(), mono: true },
    ];
  };

  const actionItems = createMemo<FileActionEntry[]>(() => {
    const currentFile = file();
    if (!currentFile) return [];
    const items = buildFileMenuElements({
      item: currentFile,
      itemPath: itemPath(),
      ctx: actionContext(),
      onCloseDetail: handleClose,
    }).filter(isActionEntry);
    return items.filter((entry) => !entry.label.startsWith("Show "));
  });

  const actionButtonClass = "btn-simple btn-sm justify-start gap-2 px-2 text-xs text-dimmed hover:text-primary";
  const dangerActionButtonClass = "btn-simple btn-sm justify-start gap-2 px-2 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300";

  return (
    <Show
      when={file()}
      fallback={
        props.showEmpty === false ? null : (
          <div class="p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-file-info text-sm" />
            Select a file to view details
          </div>
        )
      }
    >
      {(currentFile) => (
        <div class="flex h-full min-h-0 flex-col overflow-y-auto">
          <div class="flex items-start justify-end gap-2">
            <button type="button" onClick={handleClose} class="p-1 text-dimmed hover:text-primary transition-colors" aria-label="Close">
              <i class="ti ti-x" />
            </button>
          </div>

          <div class="flex flex-col gap-2 pb-0">
            <div class="flex justify-center">
              {category() === "image" && !isDirectory() ? (
                <img src={`${contentUrl()}&inline=true`} alt={currentFile().name} class="max-h-36 max-w-full rounded-xl object-contain" />
              ) : (
                <div class="flex h-18 w-18 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
                  <i class={`ti ${icon()} text-3xl`} />
                </div>
              )}
            </div>

            <div class="h-2" />

            <div class="paper overflow-hidden">
              <div class="grid grid-cols-1 divide-y divide-zinc-200 dark:divide-zinc-800">
                <For each={detailFacts()}>
                  {(fact) => (
                    <div class="px-3 py-2.5">
                      <div class="text-[11px] uppercase tracking-wider text-dimmed">{fact.label}</div>
                      <div classList={{ "font-mono break-all": fact.mono }} class="mt-1 text-xs text-primary">
                        {fact.value}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-0.5">
              <For each={actionItems()}>
                {(entry) => (
                  <button
                    type="button"
                    class={entry.variant === "danger" ? dangerActionButtonClass : actionButtonClass}
                    title={entry.label}
                    onClick={() => {
                      if ("action" in entry && entry.action) {
                        void entry.action();
                        return;
                      }
                      if ("href" in entry && entry.href) {
                        window.open(entry.href, entry.external ? "_blank" : "_self");
                      }
                    }}
                  >
                    {entry.icon && <i class={entry.icon} />}
                    <span>{entry.label === "Open" && canOpenFileInline(currentFile()) ? "Preview" : entry.label}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
