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
  detailPanelOpen: boolean;
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
  detailPanelOpen: false,
  notebooks: {},
};

// --- Cookie helpers ---

const writeCookie = (data: AllNotebookSettings) => cookies.writeJsonCookie(COOKIE_NAME, data);

const readCookie = (): AllNotebookSettings => cookies.readJsonCookie(COOKIE_NAME, DEFAULT_ALL);

const isSidebarMode = (value: unknown): value is NotebookSettings["sidebarMode"] => value === "simple" || value === "navigator";

const parseCookieHeader = (cookieHeader: string | undefined): AllNotebookSettings => {
  if (!cookieHeader) return DEFAULT_ALL;
  try {
    const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (!match) return DEFAULT_ALL;
    const parsed = JSON.parse(decodeURIComponent(match[1]!)) as Partial<AllNotebookSettings>;
    return {
      ...DEFAULT_ALL,
      ...parsed,
      notebooks: parsed.notebooks ?? {},
    };
  } catch {
    return DEFAULT_ALL;
  }
};

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
  const all = readCookie();
  const current = readSettings(notebookId);
  const next = { ...current, ...patch };
  const notebookSettings = compactNotebookSettings(next);
  const notebooks = { ...all.notebooks };
  if (Object.keys(notebookSettings).length > 0) notebooks[notebookId] = notebookSettings;
  else delete notebooks[notebookId];

  writeCookie({
    ...all,
    sidebarMode: next.sidebarMode,
    notebooks,
  });
};

/**
 * Persists the last opened notebook id for redirect/bootstrap flows.
 */
export const setLastNotebookId = (id: string) => {
  const all = readCookie();
  writeCookie({
    ...all,
    lastNotebookId: id,
  });
};

/** Persists the global detail-panel preference for SSR-stable reloads. */
export const setDetailPanelOpen = (open: boolean) => {
  writeCookie({
    ...readCookie(),
    detailPanelOpen: open,
  });
};

// --- Server-side ---

/**
 * Parses notebook settings from a raw cookie header for SSR rendering.
 */
export const parseSettings = (cookieHeader: string | undefined, notebookId: string): NotebookSettings => {
  const all = parseCookieHeader(cookieHeader);
  return {
    ...DEFAULT_SETTINGS,
    ...(all.notebooks[notebookId] ?? {}),
    sidebarMode: isSidebarMode(all.sidebarMode) ? all.sidebarMode : DEFAULT_SETTINGS.sidebarMode,
  };
};

/**
 * Parses the global detail-panel open state from a raw cookie header for SSR.
 * Defaults to false — first-time users see the panel closed.
 */
export const parseDetailPanelOpen = (cookieHeader: string | undefined): boolean => parseCookieHeader(cookieHeader).detailPanelOpen === true;

/**
 * Parses only the last notebook id from a raw cookie header for SSR redirects.
 */
export const parseLastNotebookId = (cookieHeader: string | undefined): string | null => {
  return parseCookieHeader(cookieHeader).lastNotebookId;
};
