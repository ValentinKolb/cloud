/**
 * Settings module - User preferences for spaces
 */

export {
  type DetailPanelWidth,
  type ViewType,
  type SpaceUserSettings,
  type AllSpacesSettings,
  DEFAULT_SPACE_SETTINGS,
  getDetailPanelWidthClass,
  isValidView,
  isValidPanelWidth,
  readAllSettings,
  writeAllSettings,
  readSpaceSettings,
  writeSpaceSettings,
  parseSpaceSettings,
  getLastSpaceId,
  setLastSpaceId,
  parseLastSpaceId,
} from "./SpaceSettingsStore";
