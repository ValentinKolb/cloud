import { createSignal, Show } from "solid-js";
import { SegmentedControl } from "@valentinkolb/cloud/ui";
import { type DetailPanelWidth, type ViewType, writeSpaceSettings } from "./SpaceSettingsStore";
import { buildPanelWidthUrl, clearViewOverrides } from "../filter/types";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";

type Props = {
  spaceId: string;
  /** Current effective values (from query params or defaults) */
  currentView: ViewType;
  currentPanelWidth: DetailPanelWidth;
  /** Whether current values are overridden by query params */
  hasOverride: boolean;
  /** Hide settings toggle state (from cookie) */
  hideSettings: boolean;
};

const WIDTH_OPTIONS = [
  { value: "narrow" as const, label: "S" },
  { value: "medium" as const, label: "M" },
  { value: "wide" as const, label: "L" },
  { value: "xl" as const, label: "XL" },
];

/**
 * Sidebar settings panel.
 * Sets query params to temporarily override the cookie defaults.
 */
export default function SidebarSettings(props: Props) {
  const [hideSettings, setHideSettings] = createSignal(props.hideSettings);

  const toggleMinimize = () => {
    const newValue = !hideSettings();
    setHideSettings(newValue);
    writeSpaceSettings(props.spaceId, { hideSettings: newValue });
  };

  return (
    <div class="flex flex-col gap-3">
      {/* Header with minimize toggle */}
      <div class="flex items-center justify-between">
        <div class="section-label mb-0">Right Panel</div>
        <button
          type="button"
          onClick={toggleMinimize}
          class="text-dimmed hover:text-primary transition-colors"
          title={hideSettings() ? "Expand settings" : "Minimize settings"}
        >
          <i class={`ti ${hideSettings() ? "ti-chevron-down" : "ti-chevron-up"} text-sm`} />
        </button>
      </div>

      <Show when={!hideSettings()}>
        {/* Override indicator */}
        <Show when={props.hasOverride}>
          <button
            type="button"
            onClick={() => requestSpacesRouteNavigation(clearViewOverrides())}
            class="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
          >
            <i class="ti ti-refresh text-sm" />
            <span>Reset to defaults</span>
          </button>
        </Show>

        {/* Detail panel width */}
        <SegmentedControl
          options={WIDTH_OPTIONS}
          value={() => props.currentPanelWidth}
          onChange={(v) => requestSpacesRouteNavigation(buildPanelWidthUrl(v))}
        />
      </Show>
    </div>
  );
}
