/**
 * Centralized URL query parameter handling for Notebooks app.
 */

// ============ Query Parameter Names ============

export const QueryParams = {
  NOTE: "note",
  VIEW: "view",
  MODE: "mode",
} as const;

// ============ URL Builders ============

/** Build URL for a note in edit mode */
export const buildNoteUrl = (notebookId: string, noteId: string): string => `/app/notebooks/${notebookId}?${QueryParams.NOTE}=${noteId}`;

/** Build URL for a note in read mode */
export const buildReadUrl = (notebookId: string, noteId: string): string =>
  `/app/notebooks/${notebookId}?${QueryParams.NOTE}=${noteId}&${QueryParams.VIEW}=read`;

/** Build URL for version history */
export const buildVersionsUrl = (notebookId: string, noteId: string): string =>
  `/app/notebooks/${notebookId}?${QueryParams.MODE}=versions&${QueryParams.NOTE}=${noteId}`;
