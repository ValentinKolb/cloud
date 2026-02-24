import {
  accountsApp,
  contactsApp,
  faqApp,
  filesApp,
  hostsApp,
  loggingApp,
  notebooksApp,
  notificationsApp,
  oauthApp,
  proxyAuthApp,
  quotesApp,
  settingsApp,
  spacesApp,
  syncApp,
  termsApp,
  toolsApp,
  uiLabApp,
  weatherApp,
} from "@valentinkolb/cloud-apps";

/**
 * Standalone-only built-in app list in deterministic order.
 */
export const builtInApps = [
  filesApp,
  spacesApp,
  notebooksApp,
  contactsApp,
  toolsApp,
  uiLabApp,
  weatherApp,
  quotesApp,
  accountsApp,
  hostsApp,
  notificationsApp,
  oauthApp,
  proxyAuthApp,
  syncApp,
  loggingApp,
  faqApp,
  termsApp,
  settingsApp,
] as const;

export const resolveBuiltInApps = (disabledApps: readonly string[] = []) => {
  if (disabledApps.length === 0) {
    return {
      apps: [...builtInApps],
      skippedAppIds: [] as string[],
    };
  }

  const disabled = new Set(disabledApps.map((appId) => appId.trim().toLowerCase()).filter(Boolean));
  const apps = builtInApps.filter((app) => !disabled.has(app.meta.id.toLowerCase()));
  const skippedAppIds = builtInApps
    .filter((app) => disabled.has(app.meta.id.toLowerCase()))
    .map((app) => app.meta.id);

  return { apps, skippedAppIds };
};
