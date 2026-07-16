export type MailWorkspacePreferences = {
  listCollapsed: boolean;
  listWidth: number;
};

const MAIL_WORKSPACE_COOKIE = "cloud_mail_workspace";
export const MAIL_LIST_MIN_WIDTH = 300;
export const MAIL_LIST_MAX_WIDTH = 620;
const MAIL_LIST_DEFAULT_WIDTH = 430;

const clampWidth = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return MAIL_LIST_DEFAULT_WIDTH;
  return Math.round(Math.min(MAIL_LIST_MAX_WIDTH, Math.max(MAIL_LIST_MIN_WIDTH, value)));
};

const normalizeMailWorkspacePreferences = (value: unknown): MailWorkspacePreferences => {
  if (!value || typeof value !== "object") return { listCollapsed: false, listWidth: MAIL_LIST_DEFAULT_WIDTH };
  const candidate = value as { listCollapsed?: unknown; listWidth?: unknown };
  return {
    listCollapsed: candidate.listCollapsed === true,
    listWidth: clampWidth(candidate.listWidth),
  };
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
  document.cookie = `${MAIL_WORKSPACE_COOKIE}=${encodeURIComponent(JSON.stringify(normalized))}; Path=/app/mail; Max-Age=31536000; SameSite=Lax`;
};
