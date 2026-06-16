import { dashboardSettingsService } from "./settings";

export { type DashboardSettingsResult, dashboardSettingsService, getUserSettings, saveUserSettings } from "./settings";

export const dashboardService = {
  settings: dashboardSettingsService,
};
