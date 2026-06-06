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

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  hiddenWidgets: [],
  gradient: "default",
  shortcuts: [],
};

const uniqueStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
};

const normalizeShortcut = (value: unknown): DashboardShortcut | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : crypto.randomUUID();

  if (raw.kind === "app" && typeof raw.appId === "string" && raw.appId.trim()) {
    return {
      id,
      kind: "app",
      appId: raw.appId.trim(),
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined,
      icon: typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim() : undefined,
    };
  }

  if (raw.kind === "link" && typeof raw.href === "string" && raw.href.trim()) {
    const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Shortcut";
    const icon = typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim() : "ti ti-link";
    return { id, kind: "link", href: raw.href.trim(), title, icon };
  }

  return null;
};

export const normalizeDashboardSettings = (value: unknown): DashboardSettings => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    hiddenWidgets: uniqueStrings(raw.hiddenWidgets),
    gradient: typeof raw.gradient === "string" && raw.gradient.trim() ? raw.gradient.trim() : DEFAULT_DASHBOARD_SETTINGS.gradient,
    shortcuts: Array.isArray(raw.shortcuts) ? raw.shortcuts.map(normalizeShortcut).filter((s): s is DashboardShortcut => Boolean(s)) : [],
  };
};
