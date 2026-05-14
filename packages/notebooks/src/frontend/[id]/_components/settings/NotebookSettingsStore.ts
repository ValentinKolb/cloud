/**
 * Notebook Settings Store
 *
 * Cookie-based user preferences for notebooks.
 */

import { cookies } from "@valentinkolb/stdlib/browser";

const COOKIE_NAME = "settings-app-notebooks";

export type NotebookSettings = {
  lastNoteId: string | null;
  sidebarCollapsed: boolean;
  richMode: "rich" | "source";
};

type AllNotebookSettings = {
  lastNotebookId: string | null;
  notebooks: Record<string, NotebookSettings>;
};

const DEFAULT_SETTINGS: NotebookSettings = {
  lastNoteId: null,
  sidebarCollapsed: false,
  richMode: "rich",
};

const DEFAULT_ALL: AllNotebookSettings = {
  lastNotebookId: null,
  notebooks: {},
};

// --- Cookie helpers ---

const writeCookie = (data: AllNotebookSettings) => cookies.writeJsonCookie(COOKIE_NAME, data);

const readCookie = (): AllNotebookSettings => cookies.readJsonCookie(COOKIE_NAME, DEFAULT_ALL);

// --- Client-side ---

/**
 * Reads notebook-specific UI settings in the browser.
 */
export const readSettings = (notebookId: string): NotebookSettings => {
  const all = readCookie();
  return {
    ...DEFAULT_SETTINGS,
    ...(all.notebooks[notebookId] ?? {}),
  };
};

/**
 * Merges and writes notebook-specific UI settings for the current notebook id.
 */
export const writeSettings = (notebookId: string, patch: Partial<NotebookSettings>) => {
  const all = readCookie();
  all.notebooks[notebookId] = {
    ...DEFAULT_SETTINGS,
    ...(all.notebooks[notebookId] ?? {}),
    ...patch,
  };
  writeCookie(all);
};

/**
 * Persists the last opened notebook id for redirect/bootstrap flows.
 */
export const setLastNotebookId = (id: string) => {
  const all = readCookie();
  all.lastNotebookId = id;
  writeCookie(all);
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
      return { ...DEFAULT_SETTINGS, ...(all.notebooks[notebookId] ?? {}) };
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
