/**
 * Notebook Settings Store
 *
 * Cookie-based user preferences for notebooks.
 */

import { cookies } from "@valentinkolb/cloud/lib/browser";

const COOKIE_NAME = "settings-app-notebooks";

export type NotebookSettings = {
  lastNoteId: string | null;
  sidebarCollapsed: boolean;
};

type AllNotebookSettings = {
  lastNotebookId: string | null;
  notebooks: Record<string, NotebookSettings>;
};

const DEFAULT_SETTINGS: NotebookSettings = {
  lastNoteId: null,
  sidebarCollapsed: false,
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
