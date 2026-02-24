import type { SpaceDetail, SpaceColumn, SpaceTag } from "@/spaces/contracts";
import type { SpaceUserSettings, ViewType, DetailPanelWidth } from "../settings/SpaceSettingsStore";

/**
 * Shared context object for space-related components.
 * Bundles all common props to reduce prop drilling.
 */
export type SpaceContext = {
  /** The space detail object */
  space: SpaceDetail;
  /** Columns of the space */
  columns: SpaceColumn[];
  /** Tags of the space */
  tags: SpaceTag[];
  /** Current effective view (from query param or cookie default) */
  currentView: ViewType;
  /** Current effective panel width (from query param or cookie default) */
  currentPanelWidth: DetailPanelWidth;
  /** Whether current values are overridden by query params */
  hasOverride: boolean;
  /** User settings for this space (cookie defaults) */
  settings: SpaceUserSettings;
};
