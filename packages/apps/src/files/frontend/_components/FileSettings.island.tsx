import { createSignal, Show } from "solid-js";
import { Switch } from "@valentinkolb/cloud/lib/ui";
import { SegmentedControl } from "@valentinkolb/cloud/lib/ui";
import { cookies } from "@valentinkolb/cloud/lib/browser";
import { refreshCurrentPath } from "../lib/navigation";

/** Cookie name for file settings */
const COOKIE_NAME = "settings-app-files";

/** View mode type */
export type ViewMode = "list" | "grid";

/** Grid size options */
export type GridSize = "s" | "m" | "l" | "xl";

const GRID_SIZE_VALUES: Record<GridSize, number> = {
  s: 48,
  m: 64,
  l: 96,
  xl: 128,
};

/** File settings structure */
export type FileSettings = {
  computeSizes: boolean;
  viewMode: ViewMode;
  showHidden: boolean;
  gridSize: GridSize;
  hideSettings: boolean;
};

/** Default settings */
const DEFAULT_SETTINGS: FileSettings = {
  computeSizes: false,
  viewMode: "list",
  showHidden: false,
  gridSize: "m",
  hideSettings: false,
};

/** Get pixel value for grid size */
export const getGridSizePixels = (size: GridSize): number => GRID_SIZE_VALUES[size];

/** Read settings from cookie */
const readSettings = (): FileSettings => cookies.readJsonCookie(COOKIE_NAME, DEFAULT_SETTINGS);

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

/**
 * File manager settings panel (desktop only).
 * Persists settings in a JSON cookie for server-side access.
 */
export default function FileSettings({ initialSettings }: FileSettingsProps) {
  const [settings, setSettings] = createSignal<FileSettings>(initialSettings);

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

  return (
    <div class="hidden lg:flex p-3 flex-col gap-3">
      {/* Header with minimize toggle */}
      <div class="flex items-center justify-between">
        <div class="section-label mb-0">Settings</div>
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
  if (!cookieHeader) return DEFAULT_SETTINGS;
  try {
    const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (match) {
      return {
        ...DEFAULT_SETTINGS,
        ...JSON.parse(decodeURIComponent(match[1]!)),
      };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_SETTINGS;
};
