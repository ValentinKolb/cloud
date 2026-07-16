export type MailWorkspacePreferences = {
  listCollapsed: boolean;
};

const MAIL_WORKSPACE_COOKIE = "cloud_mail_workspace";

const normalizeMailWorkspacePreferences = (value: unknown): MailWorkspacePreferences => {
  if (!value || typeof value !== "object") return { listCollapsed: false };
  return { listCollapsed: (value as { listCollapsed?: unknown }).listCollapsed === true };
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
