import { cookies } from "@valentinkolb/stdlib/browser";

const COOKIE_NAME = "settings-app-mail";

type MailUserPreferences = {
  composeFormat: "markdown" | "plain";
  undoSeconds: number;
};

type StoredMailSettings = {
  mailboxes: Record<string, Partial<MailUserPreferences>>;
};

const DEFAULT_MAIL_USER_PREFERENCES: MailUserPreferences = {
  composeFormat: "markdown",
  undoSeconds: 10,
};

const DEFAULT_SETTINGS: StoredMailSettings = { mailboxes: {} };

const normalizePreferences = (value: Partial<MailUserPreferences> | undefined): MailUserPreferences => ({
  composeFormat: value?.composeFormat === "plain" ? "plain" : "markdown",
  undoSeconds:
    typeof value?.undoSeconds === "number" && Number.isInteger(value.undoSeconds)
      ? Math.min(Math.max(value.undoSeconds, 0), 60)
      : DEFAULT_MAIL_USER_PREFERENCES.undoSeconds,
});

const readSettings = (): StoredMailSettings => {
  const stored = cookies.readJsonCookie(COOKIE_NAME, DEFAULT_SETTINGS);
  return stored && typeof stored === "object" && stored.mailboxes && typeof stored.mailboxes === "object" ? stored : DEFAULT_SETTINGS;
};

export const readMailUserPreferences = (mailboxId: string): MailUserPreferences =>
  normalizePreferences(readSettings().mailboxes[mailboxId]);

export const writeMailUserPreferences = (mailboxId: string, preferences: MailUserPreferences): MailUserPreferences => {
  const normalized = normalizePreferences(preferences);
  const current = readSettings();
  cookies.writeJsonCookie(COOKIE_NAME, {
    mailboxes: {
      ...current.mailboxes,
      [mailboxId]: normalized,
    },
  });
  return normalized;
};
