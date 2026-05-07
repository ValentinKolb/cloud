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

/** Build URL for the attachments overview (path-based, NOT a query mode). */
export const buildAttachmentsUrl = (notebookId: string): string => `/app/notebooks/${notebookId}/attachments`;

/** Build URL for an individual tag's notes page. The tag list itself
 *  lives in a modal opened from the sidebar — there's no /tags overview
 *  page anymore. */
export const buildTagPageUrl = (notebookId: string, tag: string): string =>
  `/app/notebooks/${notebookId}/tags/${encodeURIComponent(tag)}`;
