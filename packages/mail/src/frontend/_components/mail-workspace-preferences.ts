import type { MailListMode } from "../../service/workspace";
import { type MailConversationToolbarActionId, normalizeMailConversationToolbarActions } from "./mail-conversation-toolbar";

export type MailWorkspacePreferences = {
  listCollapsed: boolean;
  detailsOpen: boolean;
  toolbarActions: MailConversationToolbarActionId[];
  listMode: MailListMode;
  lastMailboxId: string | null;
};

const MAIL_WORKSPACE_COOKIE = "cloud_mail_workspace";
const isMailResourceId = (value: unknown): value is string => typeof value === "string" && /^[0-9A-Za-z]{6}$/.test(value);

const normalizeMailWorkspacePreferences = (value: unknown): MailWorkspacePreferences => ({
  listCollapsed: Boolean(value && typeof value === "object" && (value as { listCollapsed?: unknown }).listCollapsed === true),
  detailsOpen: Boolean(value && typeof value === "object" && (value as { detailsOpen?: unknown }).detailsOpen === true),
  toolbarActions: normalizeMailConversationToolbarActions(
    value && typeof value === "object" ? (value as { toolbarActions?: unknown }).toolbarActions : undefined,
  ),
  listMode: value && typeof value === "object" && (value as { listMode?: unknown }).listMode === "messages" ? "messages" : "conversations",
  lastMailboxId:
    value && typeof value === "object" && isMailResourceId((value as { lastMailboxId?: unknown }).lastMailboxId)
      ? (value as { lastMailboxId: string }).lastMailboxId
      : null,
});

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
