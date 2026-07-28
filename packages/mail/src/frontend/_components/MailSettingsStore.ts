import type { PanesNode, PanesValue } from "@valentinkolb/cloud/ui";
import { cookies } from "@valentinkolb/stdlib/browser";
import { createSignal } from "solid-js";

const COOKIE_NAME = "settings-app-mail";
const COMPOSER_PANES_COOKIE_NAME = "settings-app-mail-composer-panes";
const COMPOSER_PANE_IDS = ["editor", "preview"] as const;
const MIN_PANE_SIZE = 8;

export type MailReadingFormat = "html" | "plain";

export type MailUserPreferences = {
  composeFormat: "markdown" | "plain";
  readingFormat: MailReadingFormat;
  undoSeconds: number;
};

type StoredMailSettings = {
  mailboxes: Record<string, Partial<MailUserPreferences>>;
};

const defaultComposerPanes = (): PanesValue => ({
  root: {
    type: "leaf",
    id: "root",
    elementIds: [...COMPOSER_PANE_IDS],
    activeElementId: "editor",
    presentation: "tabs",
  },
});

const DEFAULT_MAIL_USER_PREFERENCES: MailUserPreferences = {
  composeFormat: "markdown",
  readingFormat: "html",
  undoSeconds: 10,
};

const DEFAULT_SETTINGS: StoredMailSettings = { mailboxes: {} };

const isComposerPanesNode = (value: unknown, seenNodeIds: Set<string>, seenElementIds: Set<string>, depth = 0): value is PanesNode => {
  if (!value || typeof value !== "object" || depth > 4) return false;
  const node = value as Record<string, unknown>;
  if (typeof node.id !== "string" || node.id.length === 0 || node.id.length > 100 || seenNodeIds.has(node.id)) return false;
  seenNodeIds.add(node.id);
  if (node.type === "leaf") {
    if (
      !Array.isArray(node.elementIds) ||
      node.elementIds.length === 0 ||
      node.elementIds.some(
        (id) => typeof id !== "string" || !COMPOSER_PANE_IDS.includes(id as (typeof COMPOSER_PANE_IDS)[number]) || seenElementIds.has(id),
      )
    ) {
      return false;
    }
    for (const id of node.elementIds) seenElementIds.add(id as string);
    const presentation = node.presentation ?? "single";
    return (
      (node.activeElementId === undefined ||
        (typeof node.activeElementId === "string" && node.elementIds.includes(node.activeElementId))) &&
      (presentation === "tabs" || (presentation === "single" && node.elementIds.length === 1))
    );
  }
  if (node.type !== "split" || node.direction !== "horizontal") return false;
  if (!Array.isArray(node.children) || node.children.length < 2 || node.children.length > COMPOSER_PANE_IDS.length) return false;
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) return false;
  const sizes = node.sizes;
  if (!sizes.every((size) => typeof size === "number" && Number.isFinite(size) && size > 0)) return false;
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  if (sizes.some((size) => (size / totalSize) * 100 < MIN_PANE_SIZE)) return false;
  return node.children.every((child) => isComposerPanesNode(child, seenNodeIds, seenElementIds, depth + 1));
};

export const normalizeMailComposerPanes = (value: unknown): PanesValue => {
  if (!value || typeof value !== "object" || !("root" in value)) return defaultComposerPanes();
  const seenElementIds = new Set<string>();
  if (!isComposerPanesNode((value as { root: unknown }).root, new Set(), seenElementIds)) return defaultComposerPanes();
  if (seenElementIds.size !== COMPOSER_PANE_IDS.length || COMPOSER_PANE_IDS.some((id) => !seenElementIds.has(id))) {
    return defaultComposerPanes();
  }
  return value as PanesValue;
};

const [preferencesRevision, setPreferencesRevision] = createSignal(0);

export const normalizeMailUserPreferences = (value: Partial<MailUserPreferences> | undefined): MailUserPreferences => ({
  composeFormat: value?.composeFormat === "plain" ? "plain" : "markdown",
  readingFormat: value?.readingFormat === "plain" ? "plain" : "html",
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
  normalizeMailUserPreferences(readSettings().mailboxes[mailboxId]);

export const observeMailUserPreferences = (mailboxId: string): MailUserPreferences => {
  preferencesRevision();
  return readMailUserPreferences(mailboxId);
};

export const writeMailUserPreferences = (mailboxId: string, preferences: MailUserPreferences): MailUserPreferences => {
  const normalized = normalizeMailUserPreferences(preferences);
  const current = readSettings();
  cookies.writeJsonCookie(COOKIE_NAME, {
    mailboxes: {
      ...current.mailboxes,
      [mailboxId]: normalized,
    },
  });
  setPreferencesRevision((revision) => revision + 1);
  return normalized;
};

export const readMailComposerPanes = (): PanesValue =>
  normalizeMailComposerPanes(cookies.readJsonCookie(COMPOSER_PANES_COOKIE_NAME, defaultComposerPanes()));

export const writeMailComposerPanes = (value: PanesValue): PanesValue => {
  const composerPanes = normalizeMailComposerPanes(value);
  cookies.writeJsonCookie(COMPOSER_PANES_COOKIE_NAME, composerPanes);
  return composerPanes;
};
