import { dates, fileIcons, text } from "@valentinkolb/stdlib";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Placeholder } from "@valentinkolb/cloud/ui";
import type { FileBaseInfo, FileInfo } from "@/contracts";
import { DETAIL_FILE_SELECT_EVENT, type DetailFileSelectPayload, fileApiUrl, setDetailFileInUrl } from "./context";
import { type buildFileMenuElements, canOpenFileInline, createFileActionMutations, type FileActionContext } from "./FileActions";

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
  const fileActions = createFileActionMutations();
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

  const detailScrollPreserveKey = () =>
    `files-detail-${baseType() || "none"}-${encodeURIComponent(baseId() || "none")}-${encodeURIComponent(itemPath() || "empty")}`;

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

  const actionItems = createMemo<FileActionEntry[]>(() => {
    const currentFile = file();
    if (!currentFile) return [];
    const items = fileActions
      .buildFileMenuElements({
        item: currentFile,
        itemPath: itemPath(),
        ctx: actionContext(),
        onCloseDetail: handleClose,
      })
      .filter(isActionEntry);
    return items.filter((entry) => !entry.label.startsWith("Show "));
  });

  const actionButtonClass = "btn-simple btn-sm justify-start gap-2 px-2 text-xs text-dimmed hover:text-primary";
  const dangerActionButtonClass =
    "btn-simple btn-sm justify-start gap-2 px-2 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300";

  return (
    <Show
      when={file()}
      fallback={
        props.showEmpty === false ? null : (
          <Placeholder icon="ti ti-file-info" class="h-full min-h-0 justify-center">
            Select a file to view details
          </Placeholder>
        )
      }
    >
      {(currentFile) => (
        <div class="detail-stack" data-scroll-preserve={detailScrollPreserveKey()}>
          <section class="detail-section" style="view-transition-name: files-detail-panel">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1 flex flex-col items-center gap-3">
                {category() === "image" && !isDirectory() ? (
                  <img src={`${contentUrl()}&inline=true`} alt={currentFile().name} class="max-h-36 max-w-full rounded-xl object-contain" />
                ) : (
                  <div class="flex h-18 w-18 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
                    <i class={`ti ${icon()} text-3xl`} />
                  </div>
                )}
                <div class="min-w-0 text-center">
                  <h2 class="break-all text-base font-semibold leading-tight text-primary">{currentFile().name}</h2>
                  <p class="mt-1 text-[11px] text-dimmed">
                    {isDirectory()
                      ? "Folder"
                      : `${CATEGORY_LABELS[category()] ?? "File"} · ${text.pprintBytes(currentFile().size)} · ${dates.formatDateTimeRelative(currentFile().mtime)}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                class="btn-simple btn-sm shrink-0 text-dimmed hover:text-primary"
                aria-label="Close file detail panel"
              >
                <i class="ti ti-x" />
              </button>
            </div>
          </section>

          <section class="detail-section">
            <h3 class="detail-section-label">Details</h3>
            <dl class="detail-facts">
              <dt class="detail-fact-key">Path</dt>
              <dd class="break-all font-mono">{fullPath()}</dd>
              <dt class="detail-fact-key">Kind</dt>
              <dd>{isDirectory() ? "Folder" : (CATEGORY_LABELS[category()] ?? "File")}</dd>
              <dt class="detail-fact-key">Modified</dt>
              <dd>{dates.formatDateTime(currentFile().mtime)}</dd>
              <Show when={!isDirectory()}>
                <dt class="detail-fact-key">Size</dt>
                <dd>{text.pprintBytes(currentFile().size)}</dd>
              </Show>
            </dl>
          </section>

          <Show when={actionItems().length > 0}>
            <section class="detail-section">
              <h3 class="detail-section-label">Actions</h3>
              <div class="flex flex-col gap-0.5">
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
            </section>
          </Show>
        </div>
      )}
    </Show>
  );
}
