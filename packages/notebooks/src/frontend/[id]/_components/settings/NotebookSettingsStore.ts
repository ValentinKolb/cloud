/**
 * Notebook Settings Store
 *
 * Cookie-based user preferences for notebooks.
 */

import { cookies } from "@valentinkolb/stdlib/browser";

const COOKIE_NAME = "settings-app-notebooks";

export type NotebookSettings = {
  lastNoteId: string | null;
  richMode: "rich" | "source";
  sidebarMode: "simple" | "navigator";
};

type AllNotebookSettings = {
  lastNotebookId: string | null;
  sidebarMode: NotebookSettings["sidebarMode"];
  notebooks: Record<string, Partial<Pick<NotebookSettings, "lastNoteId" | "richMode">>>;
};

const DEFAULT_SETTINGS: NotebookSettings = {
  lastNoteId: null,
  richMode: "rich",
  sidebarMode: "simple",
};

const DEFAULT_ALL: AllNotebookSettings = {
  lastNotebookId: null,
  sidebarMode: "simple",
  notebooks: {},
};

// --- Cookie helpers ---

const writeCookie = (data: AllNotebookSettings) => cookies.writeJsonCookie(COOKIE_NAME, data);

const readCookie = (): AllNotebookSettings => cookies.readJsonCookie(COOKIE_NAME, DEFAULT_ALL);

const isSidebarMode = (value: unknown): value is NotebookSettings["sidebarMode"] => value === "simple" || value === "navigator";

const compactNotebookSettings = (settings: Partial<NotebookSettings>): Partial<Pick<NotebookSettings, "lastNoteId" | "richMode">> => {
  const compact: Partial<Pick<NotebookSettings, "lastNoteId" | "richMode">> = {};
  if (typeof settings.lastNoteId === "string" && settings.lastNoteId.length > 0) compact.lastNoteId = settings.lastNoteId;
  if (settings.richMode && settings.richMode !== DEFAULT_SETTINGS.richMode) compact.richMode = settings.richMode;
  return compact;
};

// --- Client-side ---

/**
 * Reads notebook-specific UI settings in the browser.
 */
export const readSettings = (notebookId: string): NotebookSettings => {
  const all = readCookie();
  return {
    ...DEFAULT_SETTINGS,
    ...(all.notebooks[notebookId] ?? {}),
    sidebarMode: isSidebarMode(all.sidebarMode) ? all.sidebarMode : DEFAULT_SETTINGS.sidebarMode,
  };
};

/**
 * Merges and writes notebook-specific UI settings for the current notebook id.
 */
export const writeSettings = (notebookId: string, patch: Partial<NotebookSettings>) => {
  const hasCookieBackedPatch = "lastNoteId" in patch || "richMode" in patch || "sidebarMode" in patch;
  if (!hasCookieBackedPatch) return;
  const persistentPatch = compactNotebookSettings(patch);

  const all = readCookie();
  writeCookie({
    lastNotebookId: all.lastNotebookId,
    sidebarMode: patch.sidebarMode ?? (isSidebarMode(all.sidebarMode) ? all.sidebarMode : DEFAULT_SETTINGS.sidebarMode),
    notebooks: {
      [notebookId]: compactNotebookSettings({
        ...(all.notebooks[notebookId] ?? {}),
        ...persistentPatch,
      }),
    },
  });
};

/**
 * Persists the last opened notebook id for redirect/bootstrap flows.
 */
export const setLastNotebookId = (id: string) => {
  const all = readCookie();
  writeCookie({
    lastNotebookId: id,
    sidebarMode: isSidebarMode(all.sidebarMode) ? all.sidebarMode : DEFAULT_SETTINGS.sidebarMode,
    notebooks: {},
  });
};

/** Detail-panel open/closed is ephemeral UI state. Keep it out of
 *  reload-persistent storage so SSR reloads remain driven by resource URLs,
 *  not cosmetic panel state. */
export const setDetailPanelOpen = (_open: boolean) => {};

// --- Server-side ---

/**
 * Parses notebook settings from a raw cookie header for SSR rendering.
 */
export const parseSettings = (cookieHeader: string | undefined, notebookId: string): NotebookSettings => {
  if (!cookieHeader) return DEFAULT_SETTINGS;
  try {
    const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (match) {
      const all: AllNotebookSettings = {
        ...DEFAULT_ALL,
        ...JSON.parse(decodeURIComponent(match[1]!)),
      };
      return {
        ...DEFAULT_SETTINGS,
        ...(all.notebooks[notebookId] ?? {}),
        sidebarMode: isSidebarMode(all.sidebarMode) ? all.sidebarMode : DEFAULT_SETTINGS.sidebarMode,
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
};

/**
 * Parses the global detail-panel open state from a raw cookie header for SSR.
 * Defaults to false — first-time users see the panel closed.
 */
export const parseDetailPanelOpen = (_cookieHeader: string | undefined): boolean => {
  return false;
};

/**
 * Parses only the last notebook id from a raw cookie header for SSR redirects.
 */
export const parseLastNotebookId = (cookieHeader: string | undefined): string | null => {
  if (!cookieHeader) return null;
  try {
    const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (match) {
      const all: AllNotebookSettings = JSON.parse(decodeURIComponent(match[1]!));
      return all.lastNotebookId ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
};
