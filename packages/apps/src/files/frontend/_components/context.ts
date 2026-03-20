import { createContext, useContext } from "solid-js";
import type { FileBaseInfo } from "@/files/contracts";
import type { FileSettings } from "./FileSettings.island";
import { filePageBaseUrl, filePageUrl } from "../url";

// =============================================================================
// File Context - shared state for all file components
// =============================================================================

export type FileContextValue = {
  baseType: FileBaseInfo["type"];
  baseId: string;
  currentPath: string;
  bases: FileBaseInfo[];
  settings: FileSettings;
};

export const FileContext = createContext<FileContextValue>();

/**
 * Returns the file context and throws if used outside the provider tree.
 */
export const useFileContext = () => {
  const ctx = useContext(FileContext);
  if (!ctx) throw new Error("useFileContext must be used within FileProvider");
  return ctx;
};

// =============================================================================
// URL Helpers
// =============================================================================

/** Base URL for file app pages */
export const fileAppUrl = (baseType: string, baseId: string) => filePageBaseUrl(baseType, baseId);

/** URL for a specific folder path in the file app */
export const fileAppUrlForPath = (baseType: string, baseId: string, path?: string | null) => filePageUrl(baseType, baseId, path);

/** Base URL for file API */
export const fileApiUrl = (baseType: string, baseId: string) => `/api/app/files/${baseType}/${baseId}`;

/** Build full item path from current path and filename */
export const buildItemPath = (currentPath: string, filename: string) =>
  currentPath === "/" || currentPath === "" ? `/${filename}` : `${currentPath}/${filename}`;

// =============================================================================
// Selection Helpers (URL-based)
// Selection keys use format: "baseType:baseId:fullPath" for unique identification
// =============================================================================

/** Selection key for a file (unique across all bases) */
export type SelectionKey = string; // format: "baseType:baseId:fullPath"

/** Build a selection key from components */
export const buildSelectionKey = (baseType: string, baseId: string, path: string): SelectionKey => `${baseType}:${baseId}:${path}`;

/** Parse a selection key into components */
export const parseSelectionKey = (key: SelectionKey): { baseType: string; baseId: string; path: string } | null => {
  const firstColon = key.indexOf(":");
  if (firstColon === -1) return null;
  const secondColon = key.indexOf(":", firstColon + 1);
  if (secondColon === -1) return null;
  return {
    baseType: key.slice(0, firstColon),
    baseId: key.slice(firstColon + 1, secondColon),
    path: key.slice(secondColon + 1),
  };
};

/** Get filename from a selection key */
export const getFilenameFromKey = (key: SelectionKey): string => {
  const parsed = parseSelectionKey(key);
  if (!parsed) return key;
  const parts = parsed.path.split("/");
  return parts[parts.length - 1] || "";
};

/** Get selected files from URL */
export const getSelectedFromUrl = (): Set<SelectionKey> => {
  const params = new URLSearchParams(window.location.search);
  const selected = params.get("selected");
  if (!selected) return new Set();
  // Keys are separated by | since paths can contain commas
  return new Set(selected.split("|").filter(Boolean));
};

/** Custom event name for file selection changes */
export const FILE_SELECTION_EVENT = "file-selection-change";

/** Update URL with selected files (without page reload) */
export const setSelectedInUrl = (files: Set<SelectionKey>) => {
  const url = new URL(window.location.href);
  if (files.size > 0) {
    // Use | as separator since paths can contain commas
    url.searchParams.set("selected", [...files].join("|"));
  } else {
    url.searchParams.delete("selected");
  }
  window.history.replaceState({}, "", url.toString());
  // Dispatch event for other components
  window.dispatchEvent(new CustomEvent(FILE_SELECTION_EVENT, { detail: [...files] }));
};

/** Clear selection from URL */
export const clearSelection = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("selected");
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new CustomEvent(FILE_SELECTION_EVENT, { detail: [] }));
};

/** Navigate with URL search param update */
export const navigateWithParam = (key: string, value?: string) => {
  const url = new URL(window.location.href);
  value !== undefined ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  window.location.href = url.toString();
};

// =============================================================================
// Detail Panel Helpers (Hybrid SSR + Client-Side Pattern)
// =============================================================================

import type { FileInfo } from "@/files/contracts";
import { detailPanel, type DetailSelectPayload } from "@valentinkolb/cloud/lib/browser";

/** Event name for file detail panel selection changes */
export const DETAIL_FILE_SELECT_EVENT = "detail-file-select";

/** File-specific payload includes baseType and baseId for search results */
export type DetailFileSelectPayload = DetailSelectPayload<FileInfo> & {
  baseType: string;
  baseId: string;
};

/** Get the selected file path for detail panel from URL */
export const getDetailFileFromUrl = (): string | null => detailPanel.getUrlParam("file");

/**
 * Set the selected file for detail panel in URL (without page reload).
 * Updates URL via history.replaceState and dispatches event for other islands.
 */
export const setDetailFileInUrl = (fileKey: string | null, file: FileInfo | null = null, baseType: string = "", baseId: string = "") => {
  detailPanel.setUrlParam("file", fileKey);

  // Dispatch file-specific event with baseType/baseId
  window.dispatchEvent(
    new CustomEvent(DETAIL_FILE_SELECT_EVENT, {
      detail: {
        item: file,
        itemKey: fileKey,
        baseType,
        baseId,
      } as DetailFileSelectPayload,
    }),
  );
};

/** Event name for opening the file lightbox from external components (e.g. detail panel). */
export const FILE_LIGHTBOX_EVENT = "file-lightbox-open";

export type FileLightboxPayload = {
  baseType: string;
  baseId: string;
  path: string;
};

/** Requests opening the lightbox for a specific file path in a specific base. */
export const requestFileLightboxOpen = (payload: FileLightboxPayload) => {
  window.dispatchEvent(
    new CustomEvent(FILE_LIGHTBOX_EVENT, {
      detail: payload,
    }),
  );
};

/** Build URL with file parameter for detail panel */
export const buildDetailUrl = (basePath: string, currentPath: string, filePath: string): string => {
  const url = new URL(basePath, window.location.origin);
  url.searchParams.set("file", filePath);
  return url.pathname + url.search;
};

// =============================================================================
// SessionStorage Keys
// =============================================================================

export const HIGHLIGHT_STORAGE_KEY = "files-highlight";

/** Store files to highlight after navigation */
export const setHighlightedFiles = (files: string[]) => {
  if (files.length > 0) {
    sessionStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(files));
  }
};

/** Read and clear highlighted files */
export const consumeHighlightedFiles = (): string[] => {
  try {
    const stored = sessionStorage.getItem(HIGHLIGHT_STORAGE_KEY);
    if (stored) {
      sessionStorage.removeItem(HIGHLIGHT_STORAGE_KEY);
      return JSON.parse(stored) as string[];
    }
  } catch {
    // Ignore
  }
  return [];
};
