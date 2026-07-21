import { MAIL_COMMANDS, type MailProductivityCommandId } from "./mail-command-registry";

export type MailWorkspacePreferences = {
  listCollapsed: boolean;
  shortcutOverrides: Partial<Record<MailProductivityCommandId, string | null>>;
};

const MAIL_WORKSPACE_COOKIE = "cloud_mail_workspace";
const configurableCommandIds = new Set(MAIL_COMMANDS.filter((command) => command.defaultShortcut).map((command) => command.id));

export const normalizeMailShortcut = (value: string): string | null => {
  const parts = value
    .trim()
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const modifiers = new Set(parts.filter((part) => ["mod", "ctrl", "meta", "alt", "shift"].includes(part)));
  const keys = parts.filter((part) => !modifiers.has(part));
  if (keys.length !== 1 || keys[0]!.length > 20) return null;
  if (modifiers.has("ctrl") && modifiers.has("alt")) return null;
  const key = keys[0] === "escape" ? "esc" : keys[0];
  return [...["mod", "ctrl", "meta", "alt", "shift"].filter((modifier) => modifiers.has(modifier)), key].join("+");
};

const normalizeMailWorkspacePreferences = (value: unknown): MailWorkspacePreferences => {
  if (!value || typeof value !== "object") return { listCollapsed: false, shortcutOverrides: {} };
  const source = value as {
    listCollapsed?: unknown;
    shortcutOverrides?: unknown;
  };
  const shortcutOverrides: MailWorkspacePreferences["shortcutOverrides"] = {};
  if (source.shortcutOverrides && typeof source.shortcutOverrides === "object") {
    for (const [id, shortcut] of Object.entries(source.shortcutOverrides)) {
      if (!configurableCommandIds.has(id as MailProductivityCommandId)) continue;
      if (shortcut === null || shortcut === "") shortcutOverrides[id as MailProductivityCommandId] = null;
      else if (typeof shortcut === "string") {
        const normalized = normalizeMailShortcut(shortcut);
        if (normalized) shortcutOverrides[id as MailProductivityCommandId] = normalized;
      }
    }
  }
  return { listCollapsed: source.listCollapsed === true, shortcutOverrides };
};

export const readMailWorkspacePreferences = (cookieHeader: string | null | undefined): MailWorkspacePreferences => {
  const encoded = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${MAIL_WORKSPACE_COOKIE}=`))
    ?.slice(MAIL_WORKSPACE_COOKIE.length + 1);
  if (!encoded) return normalizeMailWorkspacePreferences(null);
  try {
    return normalizeMailWorkspacePreferences(JSON.parse(decodeURIComponent(encoded)));
  } catch {
    return normalizeMailWorkspacePreferences(null);
  }
};

export const writeMailWorkspacePreferences = (preferences: MailWorkspacePreferences): void => {
  const normalized = normalizeMailWorkspacePreferences(preferences);
  document.cookie = `${MAIL_WORKSPACE_COOKIE}=${encodeURIComponent(
    JSON.stringify(normalized),
  )}; Path=/app/mail; Max-Age=31536000; SameSite=Lax`;
};
