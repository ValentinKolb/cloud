import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import type { FileInfo, FileBaseInfo } from "@/files/contracts";
import { formatBytes } from "@valentinkolb/filegate/utils";
import { dates, fileIcons } from "@valentinkolb/cloud/lib/shared";
import {
  FileContext,
  type FileContextValue,
  type SelectionKey,
  fileAppUrl,
  fileAppUrlForPath,
  fileApiUrl,
  buildItemPath,
  buildSelectionKey,
  setSelectedInUrl,
  consumeHighlightedFiles,
  FILE_SELECTION_EVENT,
  setDetailFileInUrl,
  DETAIL_FILE_SELECT_EVENT,
  type DetailFileSelectPayload,
  FILE_LIGHTBOX_EVENT,
  type FileLightboxPayload,
} from "./context";
import { type FileSettings, getGridSizePixels } from "./FileSettings.island";
import FileActions from "./FileActions.island";
import { Lightbox, type LightboxImage } from "@valentinkolb/cloud/lib/ui";

type FileListProps = {
  items: FileInfo[];
  baseType: string;
  baseId: string;
  currentPath: string;
  parentPath: string | null;
  settings?: FileSettings;
  initialSelected?: string[];
  bases?: FileBaseInfo[];
  /** Hide selection checkboxes (e.g., for search results) */
  hideSelection?: boolean;
  /** Use item.path directly instead of building from currentPath + name (for search results) */
  useItemPath?: boolean;
  /** Show "no matches" instead of "empty folder" when true */
  isFiltered?: boolean;
  /** Force list view regardless of settings (for search results) */
  forceListView?: boolean;
  /** Currently selected file path for detail panel */
  selectedFilePath?: string | null;
  /** Use full detail key format (baseType:baseId:path) for search results */
  useFullDetailKey?: boolean;
};

// =============================================================================
// Action Templates
// =============================================================================

type ActionTemplate = { icon: string; label: string; inline?: boolean };

type FileCategory = ReturnType<typeof fileIcons.getFileCategory>;

const CATEGORY_ACTIONS: Record<FileCategory, ActionTemplate[]> = {
  image: [
    { icon: "ti ti-external-link", label: "Open", inline: true },
    { icon: "ti ti-download", label: "Download" },
  ],
  pdf: [
    { icon: "ti ti-external-link", label: "Open", inline: true },
    { icon: "ti ti-download", label: "Download" },
  ],
  video: [
    { icon: "ti ti-player-play", label: "Play", inline: true },
    { icon: "ti ti-download", label: "Download" },
  ],
  audio: [
    { icon: "ti ti-player-play", label: "Play", inline: true },
    { icon: "ti ti-download", label: "Download" },
  ],
  text: [
    { icon: "ti ti-file-text", label: "View", inline: true },
    { icon: "ti ti-download", label: "Download" },
  ],
  code: [
    { icon: "ti ti-code", label: "View", inline: true },
    { icon: "ti ti-download", label: "Download" },
  ],
  document: [{ icon: "ti ti-download", label: "Download" }],
  archive: [{ icon: "ti ti-download", label: "Download" }],
  other: [{ icon: "ti ti-download", label: "Download" }],
};

const DIRECTORY_ACTIONS: ActionTemplate[] = [{ icon: "ti ti-download", label: "Download .tar" }];

function buildActions(item: FileInfo, baseType: string, baseId: string, itemPath: string) {
  const isDir = item.type === "directory";
  const templates = isDir ? DIRECTORY_ACTIONS : (CATEGORY_ACTIONS[fileIcons.getFileCategory(item)] ?? DIRECTORY_ACTIONS);
  const baseUrl = `${fileApiUrl(baseType, baseId)}/content?path=${encodeURIComponent(itemPath)}`;
  return templates.map((t) => ({
    icon: t.icon,
    label: t.label,
    url: t.inline ? `${baseUrl}&inline=true` : baseUrl,
    openInNewTab: t.inline,
  }));
}

// =============================================================================
// FileList Component
// =============================================================================

const DEFAULT_SETTINGS: FileSettings = {
  computeSizes: false,
  viewMode: "list",
  gridSize: "m",
  showHidden: false,
  hideSettings: false,
};

export default function FileList({
  items,
  baseType,
  baseId,
  currentPath,
  parentPath,
  settings = DEFAULT_SETTINGS,
  initialSelected = [],
  bases = [],
  hideSelection = false,
  useItemPath = false,
  isFiltered = false,
  forceListView = false,
  selectedFilePath = null,
  useFullDetailKey = false,
}: FileListProps) {
  const baseUrl = fileAppUrl(baseType, baseId);
  const viewMode = forceListView ? "list" : settings.viewMode;
  const gridSize = getGridSizePixels(settings.gridSize);

  // Get full path for an item
  const getItemPath = (item: FileInfo): string => {
    // For search results, use item.path directly (it's already the full relative path)
    // For directory listings, build from currentPath + name
    return useItemPath ? item.path : buildItemPath(currentPath, item.name);
  };

  // Build selection key for an item
  const getSelectionKey = (item: FileInfo): SelectionKey => {
    return buildSelectionKey(baseType, baseId, getItemPath(item));
  };

  // Selection state (using full selection keys)
  const [selected, setSelected] = createSignal<Set<SelectionKey>>(new Set(initialSelected));

  // Highlighted files (using filenames only, not full paths)
  const [highlighted, setHighlighted] = createSignal<Set<string>>(new Set());

  // Detail panel selection (local state for instant highlighting without reload)
  const [detailSelectedPath, setDetailSelectedPath] = createSignal<string | null>(selectedFilePath ?? null);

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = createSignal<number | null>(null);

  // Build list of images for lightbox
  const imageItems = items.filter((item) => item.type === "file" && fileIcons.getFileCategory(item) === "image");
  const lightboxImages: LightboxImage[] = imageItems.map((item) => {
    const itemPath = getItemPath(item);
    const contentUrl = `${fileApiUrl(baseType, baseId)}/content?path=${encodeURIComponent(itemPath)}`;
    return {
      src: `${contentUrl}&inline=true`,
      alt: item.name,
      downloadUrl: contentUrl,
    };
  });

  // Open lightbox for a specific image path.
  // Falls back to matching by name for compatibility with older callers.
  const openLightbox = (imagePath: string) => {
    const idx = imageItems.findIndex((item) => {
      const path = getItemPath(item);
      return path === imagePath || item.name === imagePath;
    });
    if (idx !== -1) setLightboxIndex(idx);
  };

  // Toggle selection for a file (using selection key)
  const toggleSelect = (item: FileInfo) => {
    const key = getSelectionKey(item);
    const current = new Set(selected());
    current.has(key) ? current.delete(key) : current.add(key);
    setSelected(current);
    setSelectedInUrl(current);
  };

  // Sync with external selection changes
  onMount(() => {
    // Load highlights from sessionStorage
    const highlightedFiles = consumeHighlightedFiles();
    if (highlightedFiles.length > 0) {
      setHighlighted(new Set(highlightedFiles));
    }

    // Listen for selection changes from toolbar
    const selectionHandler = (e: Event) => {
      setSelected(new Set((e as CustomEvent<string[]>).detail));
    };
    window.addEventListener(FILE_SELECTION_EVENT, selectionHandler);

    // Listen for detail panel selection changes (for instant highlighting)
    const detailHandler = (e: Event) => {
      const payload = (e as CustomEvent<DetailFileSelectPayload>).detail;
      // Only update if this FileList's base matches or if using full key
      if (useFullDetailKey) {
        // For search: extract path from full key if bases match
        if (payload.baseType === baseType && payload.baseId === baseId) {
          setDetailSelectedPath(payload.item?.path ?? null);
        } else {
          setDetailSelectedPath(null);
        }
      } else {
        // For normal view: use itemKey directly (it's just the path)
        setDetailSelectedPath(payload.itemKey);
      }
    };
    window.addEventListener(DETAIL_FILE_SELECT_EVENT, detailHandler);

    const lightboxHandler = (e: Event) => {
      const payload = (e as CustomEvent<FileLightboxPayload>).detail;
      if (payload.baseType !== baseType || payload.baseId !== baseId) return;
      openLightbox(payload.path);
    };
    window.addEventListener(FILE_LIGHTBOX_EVENT, lightboxHandler);

    onCleanup(() => {
      window.removeEventListener(FILE_SELECTION_EVENT, selectionHandler);
      window.removeEventListener(DETAIL_FILE_SELECT_EVENT, detailHandler);
      window.removeEventListener(FILE_LIGHTBOX_EVENT, lightboxHandler);
    });
  });

  // Build detail file key for URL (either just path or full baseType:baseId:path)
  const buildDetailKey = (itemPath: string): string => {
    return useFullDetailKey ? `${baseType}:${baseId}:${itemPath}` : itemPath;
  };

  // Context value for child components
  const contextValue: FileContextValue = {
    baseType,
    baseId,
    currentPath,
    bases,
    settings,
    openLightbox,
  };

  const isGrid = viewMode === "grid";

  // Calculate grid item width based on gridSize (icon + padding)
  const gridItemWidth = gridSize + 24; // icon size + ~24px padding

  return (
    <FileContext.Provider value={contextValue}>
      <div
        class="overflow-hidden"
        classList={{
          "flex flex-col app-divider": !isGrid,
          "grid gap-1 p-2": isGrid,
        }}
        style={
          isGrid
            ? {
                "grid-template-columns": `repeat(auto-fill, minmax(${gridItemWidth}px, 1fr))`,
              }
            : undefined
        }
      >
        {/* Parent directory */}
        <Show when={parentPath !== null}>
          <a
            href={fileAppUrlForPath(baseType, baseId, parentPath!)}
            class="flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors group"
            classList={{
              "px-3 py-2.5": !isGrid,
              "flex-col p-2 thumbnail": isGrid,
            }}
          >
            <div
              class="flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-500 thumbnail"
              style={isGrid ? { width: `${gridSize}px`, height: `${gridSize}px` } : { width: "32px", height: "32px" }}
            >
              <i
                class="ti ti-folder-up"
                classList={{
                  "text-lg": !isGrid,
                  "text-3xl": gridSize < 64,
                  "text-4xl": gridSize >= 64 && gridSize < 96,
                  "text-5xl": gridSize >= 96,
                }}
              />
            </div>
            <span
              classList={{
                "text-sm": !isGrid,
                "text-[11px] mt-1.5": isGrid,
              }}
              class="text-secondary group-hover:text-primary transition-colors"
            >
              ..
            </span>
          </a>
        </Show>

        {/* File items */}
        <For each={items}>
          {(item) => {
            const itemPath = getItemPath(item);
            return (
              <FileItem
                item={item}
                ctx={contextValue}
                itemPath={itemPath}
                isSelected={!hideSelection && selected().has(getSelectionKey(item))}
                isHighlighted={highlighted().has(item.name)}
                isDetailSelected={detailSelectedPath() === itemPath}
                onToggleSelect={() => toggleSelect(item)}
                onSelectForDetail={() => setDetailFileInUrl(buildDetailKey(itemPath), item, baseType, baseId)}
                hideCheckbox={hideSelection}
              />
            );
          }}
        </For>

        {/* Empty state */}
        <Show when={items.length === 0 && parentPath === null}>
          <div
            class="flex gap-2 justify-center text-xs text-dimmed"
            classList={{
              "px-4 py-8": !isGrid,
              "col-span-full py-8": isGrid,
            }}
          >
            <i class={`ti ${isFiltered ? "ti-filter-off" : "ti-folder-open"}`} />
            <span>{isFiltered ? "No files match the filter" : "This folder is empty"}</span>
          </div>
        </Show>
      </div>

      {/* Lightbox */}
      <Show when={lightboxIndex() !== null && lightboxImages.length > 0}>
        <Lightbox images={lightboxImages} initialIndex={lightboxIndex()!} onClose={() => setLightboxIndex(null)} />
      </Show>
    </FileContext.Provider>
  );
}

// =============================================================================
// FileItem Component (inline - no separate file needed)
// =============================================================================

function FileItem(props: {
  item: FileInfo;
  ctx: FileContextValue;
  itemPath: string;
  isSelected: boolean;
  isHighlighted: boolean;
  isDetailSelected: boolean;
  onToggleSelect: () => void;
  onSelectForDetail: () => void;
  hideCheckbox?: boolean;
}) {
  const { item, ctx, itemPath } = props;
  const { viewMode, gridSize: gridSizeKey } = ctx.settings;
  const gridSize = getGridSizePixels(gridSizeKey);
  const isGrid = viewMode === "grid";

  const isDir = item.type === "directory";
  const href = isDir ? fileAppUrlForPath(ctx.baseType, ctx.baseId, itemPath) : undefined;

  const icon = fileIcons.getFileIcon(item);
  const actions = buildActions(item, ctx.baseType, ctx.baseId, itemPath);

  // Handle click on file row (opens detail panel)
  const handleFileClick = (e: MouseEvent) => {
    if (isDir) return;
    // Don't trigger if clicking on checkbox or other interactive elements
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    props.onSelectForDetail();
  };

  const handleFileKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onSelectForDetail();
    }
  };

  // Calculate icon text size based on gridSize
  const iconTextSize = gridSize >= 96 ? "text-5xl" : gridSize >= 64 ? "text-4xl" : "text-3xl";

  // Grid view
  if (isGrid) {
    return (
      <div
        class="relative group flex flex-col items-center p-2 thumbnail transition-colors cursor-pointer"
        classList={{
          "bg-blue-100 dark:bg-blue-900/40": props.isDetailSelected,
          "bg-blue-50 dark:bg-blue-950/30": props.isHighlighted && !props.isDetailSelected,
          "hover:bg-zinc-100 dark:hover:bg-zinc-800/50": !props.isHighlighted && !props.isDetailSelected,
        }}
        onClick={handleFileClick}
        onKeyDown={handleFileKeyDown}
        role="button"
        tabIndex={0}
      >
        {/* Checkbox overlay */}
        <Show when={!props.hideCheckbox}>
          <input
            type="checkbox"
            checked={props.isSelected}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleSelect();
            }}
            class="absolute top-1 left-1 z-10"
            classList={{
              "opacity-0 group-hover:opacity-100": !props.isSelected,
            }}
          />
        </Show>

        {/* Info button for folders (opens detail panel) */}
        <Show when={isDir}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onSelectForDetail();
            }}
            class="absolute top-1 right-1 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 text-dimmed hover:text-blue-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            title="Show details"
          >
            <i class="ti ti-info-circle text-sm" />
          </button>
        </Show>

        {/* Icon */}
        {isDir ? (
          <a href={href} class="flex flex-col items-center w-full">
            <div
              class="flex items-center justify-center thumbnail bg-zinc-100 dark:bg-zinc-800 transition-colors mb-1.5"
              style={{ width: `${gridSize}px`, height: `${gridSize}px` }}
            >
              <i class={`ti ${icon} ${iconTextSize} group-hover:hidden`} />
              <i class={`ti ti-folder-open text-blue-500 ${iconTextSize} hidden group-hover:inline`} />
            </div>
            <span
              class="text-[11px] text-center w-full truncate leading-tight"
              classList={{
                "text-dimmed": item.isHidden,
                "text-primary": !item.isHidden,
              }}
              title={item.name}
            >
              {item.name}
            </span>
          </a>
        ) : fileIcons.getFileCategory(item) === "image" ? (
          <div class="flex flex-col items-center w-full">
            <div class="thumbnail bg-zinc-100 dark:bg-zinc-800 mb-1.5" style={{ width: `${gridSize}px`, height: `${gridSize}px` }}>
              <img
                src={`${fileApiUrl(ctx.baseType, ctx.baseId)}/thumbnail?path=${encodeURIComponent(itemPath)}`}
                alt={item.name}
                class="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <span
              class="text-[11px] text-center w-full truncate leading-tight"
              classList={{
                "text-dimmed": item.isHidden,
                "text-primary": !item.isHidden,
              }}
              title={item.name}
            >
              {item.name}
            </span>
          </div>
        ) : (
          <div class="flex flex-col items-center w-full">
            <div
              class="flex items-center justify-center thumbnail bg-zinc-100 dark:bg-zinc-800 mb-1.5"
              style={{ width: `${gridSize}px`, height: `${gridSize}px` }}
            >
              <i class={`ti ${icon} ${iconTextSize}`} />
            </div>
            <span
              class="text-[11px] text-center w-full truncate leading-tight"
              classList={{
                "text-dimmed": item.isHidden,
                "text-primary": !item.isHidden,
              }}
              title={item.name}
            >
              {item.name}
            </span>
          </div>
        )}
      </div>
    );
  }

  // List view
  const rowClass = () => {
    let cls = "flex items-center gap-3 px-3 py-2.5 transition-colors";
    if (props.isDetailSelected) {
      cls += " bg-blue-100 dark:bg-blue-900/40";
    } else if (props.isHighlighted) {
      cls += " bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/30";
    } else {
      // Only apply gray hover when not selected
      cls += " hover:bg-zinc-100 dark:hover:bg-zinc-800/50";
    }
    if (isDir) {
      cls += " group";
    } else {
      cls += " cursor-pointer";
    }
    return cls;
  };

  // Checkbox element
  const checkbox = (
    <input
      type="checkbox"
      checked={props.isSelected}
      onClick={(e) => {
        e.stopPropagation();
        props.onToggleSelect();
      }}
      class="shrink-0"
    />
  );

  // Icon element (with thumbnail for images)
  const isImage = !isDir && fileIcons.getFileCategory(item) === "image";
  const iconEl = isDir ? (
    <div class="w-8 h-8 flex items-center justify-center thumbnail bg-zinc-100 dark:bg-zinc-800 shrink-0 transition-colors">
      <i class={`ti ${icon} text-lg group-hover:hidden`} />
      <i class="ti ti-folder-open text-blue-500 text-lg hidden group-hover:inline" />
    </div>
  ) : isImage ? (
    <button
      type="button"
      class="w-8 h-8 thumbnail bg-zinc-100 dark:bg-zinc-800 shrink-0 relative cursor-pointer"
      onClick={() => ctx.openLightbox?.(itemPath)}
    >
      <i class={`ti ${icon} text-lg absolute inset-0 flex items-center justify-center`} />
      <img
        src={`${fileApiUrl(ctx.baseType, ctx.baseId)}/thumbnail?path=${encodeURIComponent(itemPath)}`}
        alt=""
        class="w-full h-full object-cover relative z-10"
        loading="lazy"
      />
    </button>
  ) : (
    <div class="w-8 h-8 flex items-center justify-center thumbnail bg-zinc-100 dark:bg-zinc-800 shrink-0">
      <i class={`ti ${icon} text-lg`} />
    </div>
  );

  // Name element
  const nameEl = (
    <span
      class={`text-sm truncate ${
        item.isHidden ? "text-dimmed" : "text-primary"
      } ${isDir ? "group-hover:text-primary transition-colors" : ""}`}
    >
      {item.name}
      <Show when={props.isHighlighted}>
        <span class="ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
          moved
        </span>
      </Show>
    </span>
  );

  // Meta + actions (responsive)
  const metaEl = (
    <div class="flex items-center gap-4 text-xs text-dimmed shrink-0">
      <Show when={item.size > 0}>
        <span class="hidden sm:inline">{formatBytes({ bytes: item.size })}</span>
      </Show>
      <span class="hidden md:inline">{dates.formatDateRelative(item.mtime)}</span>
      {/* Folders get info icon to open detail panel */}
      <Show when={isDir}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onSelectForDetail();
          }}
          class="text-dimmed hover:text-blue-500 transition-colors p-1"
          title="Show details"
        >
          <i class="ti ti-info-circle" />
        </button>
      </Show>
    </div>
  );

  if (isDir) {
    return (
      <div class={rowClass()}>
        <Show when={!props.hideCheckbox}>{checkbox}</Show>
        <a href={href} class="flex items-center gap-3 flex-1 min-w-0">
          {iconEl}
          <div class="flex-1 min-w-0">{nameEl}</div>
        </a>
        {metaEl}
      </div>
    );
  }

  // File row - clicking opens detail panel
  return (
    <div class={rowClass()} onClick={handleFileClick} onKeyDown={handleFileKeyDown} role="button" tabIndex={0}>
      <Show when={!props.hideCheckbox}>{checkbox}</Show>
      {iconEl}
      <div class="flex-1 min-w-0">{nameEl}</div>
      {metaEl}
    </div>
  );
}
