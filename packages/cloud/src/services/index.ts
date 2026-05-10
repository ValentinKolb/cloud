export { ipa } from "./ipa";
export { accounts } from "./accounts";
export { accountsAppService } from "./accounts";
export { providers } from "./providers";
export { authFlows } from "./auth-flows";
export { toPgTextArray, toPgUuidArray, escapeLikePattern, isUniqueViolation } from "./postgres";

export { logger, logging } from "./logging";
export type { LogEntry } from "./logging";

export { notifications } from "./notifications";
export type {
  NotificationType,
  NotificationStatus,
  SendNotificationParams,
  SendToUserParams,
  NotificationMessage,
} from "./notifications";

export { session } from "./session";

export { accountLifecycle } from "./account-lifecycle";
export type { AccountLifecycleService } from "./account-lifecycle";
export { lifecycleJobs } from "./account-lifecycle/scheduler";

export { settings } from "./settings/namespace";
export { loadCache, get, set, remove, getAll } from "./settings";
export type { SettingEntry } from "./settings";
export { SETTINGS, SETTINGS_MAP, SETTING_GROUPS, GROUP_LABELS, registerSettings, registerGroupLabel } from "./settings/defaults";
export { validateSettingValue, normalizeSettingValue, getSettingLabel } from "./settings/defaults";
export type { SettingDef, SettingKind, SettingOption } from "./settings/defaults";
export { renderTemplate } from "./settings/templates";
export { settingsService } from "./settings/app";
export type { SettingsService } from "./settings/app";

// Typed async API + cache-aside primitives.
export { coreSettings, createSettingsAPI } from "./settings/api";
export type { SettingsAPI } from "./settings/api";
export { readKey as settingsReadKey, writeKey as settingsWriteKey, deleteKey as settingsDeleteKey, bulkRead as settingsBulkRead, allKnownKeys as settingsAllKnownKeys } from "./settings/store";
export { loadSnapshot as loadSettingsSnapshot } from "./settings/snapshot";

export { weatherService } from "./weather";
export type { WeatherService, WeatherData, DailyForecast, CurrentWeather, HourlyForecast, WeatherIcon } from "./weather";
export { migrate as migrateWeather } from "./weather/migrate";
export { getFreeIpaConfig } from "./freeipa-config";
export type { FreeIpaConfig } from "./freeipa-config";
