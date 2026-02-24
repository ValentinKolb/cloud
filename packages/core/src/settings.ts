import type { SettingDef } from "./services/settings/defaults";

export { SETTINGS, SETTINGS_MAP, SETTING_GROUPS, GROUP_LABELS, registerSettings, registerGroupLabel } from "./services/settings/defaults";
export type { SettingDef, SettingType } from "./services/settings/defaults";

export type SettingEntry = {
  key: string;
  type: SettingDef["type"];
  description: string;
  placeholder?: string;
  group: string;
  value: unknown;
  default: unknown;
  isCustom: boolean;
  templateVars?: string[];
};
