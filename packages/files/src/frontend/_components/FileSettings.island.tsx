import { createMemo, createSignal, Show } from "solid-js";
import { Dropdown, SegmentedControl, Switch } from "@valentinkolb/cloud/ui";
import { cookies } from "@valentinkolb/stdlib/browser";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";

/** Cookie name for file settings */
const COOKIE_NAME = "settings-app-files";

/** View mode type */
export type ViewMode = "list" | "grid";
export type FileListColumn = "size" | "mime" | "modified";
export type ListDensity = "comfortable" | "compact";

/** Grid size options */
export type GridSize = "s" | "m" | "l" | "xl";

const GRID_SIZE_VALUES: Record<GridSize, number> = {
  s: 64,
  m: 92,
  l: 136,
  xl: 184,
};

/** File settings structure */
export type FileSettings = {
  computeSizes: boolean;
  viewMode: ViewMode;
  showHidden: boolean;
  gridSize: GridSize;
  hideSettings: boolean;
  listColumns: FileListColumn[];
  listDensity: ListDensity;
};

/** Default settings */
export const DEFAULT_FILE_SETTINGS: FileSettings = {
  computeSizes: false,
  viewMode: "list",
  showHidden: false,
  gridSize: "m",
  hideSettings: false,
  listColumns: ["size", "modified"],
  listDensity: "comfortable",
};

/** Get pixel value for grid size */
export const getGridSizePixels = (size: GridSize): number => GRID_SIZE_VALUES[size];

/** Write settings to cookie */
const writeSettings = (settings: FileSettings) => cookies.writeJsonCookie(COOKIE_NAME, settings);

type FileSettingsProps = {
  /** Initial settings from server-side cookie read */
  initialSettings: FileSettings;
};

const GRID_SIZE_OPTIONS: { value: GridSize; label: string }[] = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

const LIST_COLUMN_OPTIONS: { value: FileListColumn; label: string; icon: string }[] = [
  { value: "size", label: "File size", icon: "ti ti-ruler-measure" },
  { value: "mime", label: "MIME type", icon: "ti ti-file-type" },
  { value: "modified", label: "Updated", icon: "ti ti-clock" },
];

/**
 * File manager settings panel (desktop only).
 * Persists settings in a JSON cookie for server-side access.
 */
export default function FileSettings({ initialSettings }: FileSettingsProps) {
  const [settings, setSettings] = createSignal<FileSettings>(initialSettings);
  const selectedColumnsLabel = createMemo(() => {
    const selected = settings().listColumns;
    if (selected.length === LIST_COLUMN_OPTIONS.length) return "All columns";
    if (selected.length === 0) return "No extras";
    return LIST_COLUMN_OPTIONS.filter((option) => selected.includes(option.value))
      .map((option) => option.label)
      .join(", ");
  });

  const updateSetting = <K extends keyof FileSettings>(key: K, value: FileSettings[K]) => {
    const newSettings = { ...settings(), [key]: value };
    setSettings(newSettings);
    writeSettings(newSettings);
    // Reload to apply new setting server-side (except for hideSettings)
    if (key !== "hideSettings") {
      refreshCurrentPath();
    }
  };

  const toggleMinimize = () => {
    updateSetting("hideSettings", !settings().hideSettings);
  };

  const toggleListColumn = (column: FileListColumn) => {
    const current = settings().listColumns;
    const next = current.includes(column) ? current.filter((value) => value !== column) : [...current, column];
    updateSetting("listColumns", next);
  };

  return (
    <div id="files-sidebar-settings" class="flex flex-col gap-3 px-1 pt-1">
      {/* Header with minimize toggle */}
      <div class="flex items-center justify-between">
        <p class="sidebar-section-title pt-0">Panel</p>
        <button
          type="button"
          onClick={toggleMinimize}
          class="text-dimmed hover:text-primary transition-colors"
          title={settings().hideSettings ? "Expand settings" : "Minimize settings"}
        >
          <i class={`ti ${settings().hideSettings ? "ti-chevron-down" : "ti-chevron-up"} text-sm`} />
        </button>
      </div>

      <Show when={!settings().hideSettings}>
        <div class="flex flex-col gap-3">
          {/* View mode toggle */}
          <SegmentedControl
            options={[
              { value: "list" as ViewMode, label: "List", icon: "ti ti-list" },
              {
                value: "grid" as ViewMode,
                label: "Grid",
                icon: "ti ti-grid-dots",
              },
            ]}
            value={() => settings().viewMode}
            onChange={(v) => updateSetting("viewMode", v)}
          />

          {/* Grid size options (only shown in grid mode) */}
          <Show when={settings().viewMode === "grid"}>
            <div class="flex flex-col gap-1">
              <div class="text-xs text-secondary">Icon size</div>
              <SegmentedControl
                options={GRID_SIZE_OPTIONS}
                value={() => settings().gridSize}
                onChange={(v) => updateSetting("gridSize", v)}
              />
            </div>
          </Show>

          <Show when={settings().viewMode === "list"}>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1">
                <div class="text-xs text-secondary">Density</div>
                <SegmentedControl
                  options={[
                    { value: "compact" as ListDensity, label: "Compact" },
                    { value: "comfortable" as ListDensity, label: "Cozy" },
                  ]}
                  value={() => settings().listDensity}
                  onChange={(v) => updateSetting("listDensity", v)}
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <div class="text-xs text-secondary">List columns</div>
                <Dropdown
                  trigger={
                    <span class="btn-input btn-sm w-full justify-between text-left">
                      <span class="inline-flex min-w-0 items-center gap-2 truncate">
                        <i class="ti ti-columns-3 text-sm text-blue-500" />
                        <span class="truncate text-xs">{selectedColumnsLabel()}</span>
                      </span>
                      <i class="ti ti-chevron-down text-[10px] text-dimmed" />
                    </span>
                  }
                  width="w-52"
                  position="bottom-right"
                  elements={LIST_COLUMN_OPTIONS.map((option) => ({
                    element: (close) => (
                      <button
                        type="button"
                        class="flex w-full items-center gap-3 px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-white/30 dark:text-zinc-300 dark:hover:bg-white/10"
                        onClick={() => {
                          toggleListColumn(option.value);
                          close();
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={settings().listColumns.includes(option.value)}
                          readOnly
                          class="pointer-events-none"
                        />
                        <i class={`${option.icon} text-dimmed`} />
                        <span>{option.label}</span>
                      </button>
                    ),
                  }))}
                />
              </div>
            </div>
          </Show>

          {/* Show hidden files toggle */}
          <Switch label="Show hidden files" value={() => settings().showHidden} onChange={(v) => updateSetting("showHidden", v)} />

          {/* Compute sizes toggle */}
          <div class="flex flex-col gap-1">
            <Switch label="Precise file sizes" value={() => settings().computeSizes} onChange={(v) => updateSetting("computeSizes", v)} />
            <Show when={settings().computeSizes}>
              <p class="text-[10px] text-orange-500 pl-11">May slow down page</p>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

/** Parse settings from cookie string (for server-side use) */
export const parseFileSettings = (cookieHeader: string | undefined): FileSettings => {
  if (!cookieHeader) return DEFAULT_FILE_SETTINGS;
  try {
    const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (match) {
      const parsed = JSON.parse(decodeURIComponent(match[1]!)) as Partial<FileSettings>;
      const listColumns = Array.isArray(parsed.listColumns)
        ? parsed.listColumns.filter((value): value is FileListColumn => ["size", "mime", "modified"].includes(String(value)))
        : DEFAULT_FILE_SETTINGS.listColumns;
      const listDensity = parsed.listDensity === "compact" ? "compact" : DEFAULT_FILE_SETTINGS.listDensity;
      return {
        ...DEFAULT_FILE_SETTINGS,
        ...parsed,
        listColumns,
        listDensity,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_FILE_SETTINGS;
};
