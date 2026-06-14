export const DASHBOARD_COOKIE = "dashboard_settings";

export type DashboardShortcut =
  | {
      id: string;
      kind: "app";
      appId: string;
      title?: string;
      icon?: string;
    }
  | {
      id: string;
      kind: "link";
      href: string;
      title: string;
      icon: string;
    };

export type DashboardSettings = {
  hiddenWidgets: string[];
  gradient: string;
  shortcuts: DashboardShortcut[];
};

export type DashboardWidgetSummary = {
  key: string;
  title: string;
  icon: string;
};

export type DashboardAppSummary = {
  id: string;
  name: string;
  icon: string;
  href: string;
  description: string;
};

export type DashboardLegalLink = {
  label: string;
  href: string;
  icon?: string;
};

export const DASHBOARD_MAX_ITEMS = 100;
export const DASHBOARD_MAX_SHORTCUTS = 50;
export const DASHBOARD_MAX_ID_LENGTH = 120;
export const DASHBOARD_MAX_TITLE_LENGTH = 80;
export const DASHBOARD_MAX_HREF_LENGTH = 2_000;

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  hiddenWidgets: [],
  gradient: "default",
  shortcuts: [],
};

export const normalizeDashboardShortcutHref = (href: string): string => {
  const trimmed = href.trim();
  if (!trimmed || /^([a-z][a-z0-9+.-]*:|\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

export const isSafeDashboardShortcutHref = (href: string): boolean => /^(\/|https?:\/\/|mailto:)/i.test(href);

const uniqueStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const strings = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= DASHBOARD_MAX_ID_LENGTH);
  return [...new Set(strings)].slice(0, DASHBOARD_MAX_ITEMS);
};

const parseJsonString = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const normalizeShortcut = (value: unknown): DashboardShortcut | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, DASHBOARD_MAX_ID_LENGTH) : crypto.randomUUID();

  if (raw.kind === "app" && typeof raw.appId === "string" && raw.appId.trim()) {
    return {
      id,
      kind: "app",
      appId: raw.appId.trim().slice(0, DASHBOARD_MAX_ID_LENGTH),
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, DASHBOARD_MAX_TITLE_LENGTH) : undefined,
      icon: typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim().slice(0, DASHBOARD_MAX_ID_LENGTH) : undefined,
    };
  }

  if (raw.kind === "link" && typeof raw.href === "string" && raw.href.trim()) {
    const href = normalizeDashboardShortcutHref(raw.href).slice(0, DASHBOARD_MAX_HREF_LENGTH);
    if (!isSafeDashboardShortcutHref(href)) return null;
    const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, DASHBOARD_MAX_TITLE_LENGTH) : "Shortcut";
    const icon = typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim().slice(0, DASHBOARD_MAX_ID_LENGTH) : "ti ti-link";
    return { id, kind: "link", href, title, icon };
  }

  return null;
};

export const normalizeDashboardSettings = (value: unknown): DashboardSettings => {
  const parsed = parseJsonString(value);
  const raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const shortcuts = parseJsonString(raw.shortcuts);
  return {
    hiddenWidgets: uniqueStrings(raw.hiddenWidgets),
    gradient:
      typeof raw.gradient === "string" && raw.gradient.trim()
        ? raw.gradient.trim().slice(0, DASHBOARD_MAX_ID_LENGTH)
        : DEFAULT_DASHBOARD_SETTINGS.gradient,
    shortcuts: Array.isArray(shortcuts)
      ? shortcuts
          .map(normalizeShortcut)
          .filter((s): s is DashboardShortcut => Boolean(s))
          .slice(0, DASHBOARD_MAX_SHORTCUTS)
      : [],
  };
};
