import type { SettingDef } from "./services/settings/defaults";

export { SETTINGS, SETTINGS_MAP, SETTING_GROUPS, GROUP_LABELS, registerSettings, registerGroupLabel } from "./services/settings/defaults";
export { validateSettingValue, normalizeSettingValue, getSettingLabel } from "./services/settings/defaults";
export type { SettingDef, SettingKind, SettingOption } from "./services/settings/defaults";

export type SettingEntry = {
  key: string;
  label: string;
  kind: SettingDef["kind"];
  description: string;
  placeholder?: string;
  group: string;
  value: unknown;
  default: unknown;
  isCustom: boolean;
  templateVars?: string[];
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
};
