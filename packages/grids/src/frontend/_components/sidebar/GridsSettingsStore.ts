import { cookies } from "@valentinkolb/stdlib/browser";

const COOKIE_NAME = "settings-app-grids";

type GridsSettings = {
  lastPath: string | null;
};

const DEFAULT_SETTINGS: GridsSettings = {
  lastPath: null,
};

const normalizeSettings = (raw: unknown): GridsSettings => {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const candidate = raw as Partial<GridsSettings>;
  return {
    lastPath: typeof candidate.lastPath === "string" ? candidate.lastPath : null,
  };
};

const isSafeGridsPath = (path: string): boolean => path === "/app/grids" || path.startsWith("/app/grids/");

const readGridsSettings = (): GridsSettings => normalizeSettings(cookies.readJsonCookie(COOKIE_NAME, DEFAULT_SETTINGS));

const writeGridsSettings = (settings: GridsSettings) => cookies.writeJsonCookie(COOKIE_NAME, settings);

export const setLastGridsPath = (path: string) => {
  if (!isSafeGridsPath(path) || path === "/app/grids") return;
  writeGridsSettings({ ...readGridsSettings(), lastPath: path });
};

const parseCookie = (cookieHeader: string | undefined): GridsSettings => {
  if (!cookieHeader) return DEFAULT_SETTINGS;
  try {
    const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (match) return normalizeSettings(JSON.parse(decodeURIComponent(match[1]!)));
  } catch {
    // Ignore invalid user cookies.
  }
  return DEFAULT_SETTINGS;
};

export const parseLastGridsPath = (cookieHeader: string | undefined): string | null => {
  const path = parseCookie(cookieHeader).lastPath;
  return path && isSafeGridsPath(path) ? path : null;
};
