/**
 * URL builders for the Notebooks app.
 *
 * Path shape: `/app/notebooks/{notebookShortId}/notes/{noteShortId}` —
 * all user-visible IDs are 6-char base62 short-ids (see
 * `lib/short-id.ts`). The builders accept *any* string and don't
 * validate, because the page-handler boundary resolves either UUID or
 * short-id (`getByIdOrShortId`) — but every call site should pass a
 * short-id so URLs stay readable and shareable.
 *
 * View / mode toggles (`view=read`, `mode=versions`, `mode=settings`,
 * `mode=graph`) stay as query params: they're modes on the same
 * resource, not different resources, and forcing them into the path
 * would multiply the route registrations without UX gain.
 */

// ============ Query Parameter Names ============

export const QueryParams = {
  VIEW: "view",
  MODE: "mode",
} as const;

// ============ URL Builders ============

/** Build URL for a note in edit mode. */
export const buildNoteUrl = (notebookShortId: string, noteShortId: string): string =>
  `/app/notebooks/${notebookShortId}/notes/${noteShortId}`;

/** Build URL for a note in read mode. */
export const buildReadUrl = (notebookShortId: string, noteShortId: string): string =>
  `/app/notebooks/${notebookShortId}/notes/${noteShortId}?${QueryParams.VIEW}=read`;

/** Build URL for version history. */
export const buildVersionsUrl = (notebookShortId: string, noteShortId: string): string =>
  `/app/notebooks/${notebookShortId}/notes/${noteShortId}?${QueryParams.MODE}=versions`;

/** Build URL for the attachments overview (path-based, NOT a query mode). */
export const buildAttachmentsUrl = (notebookShortId: string): string =>
  `/app/notebooks/${notebookShortId}/attachments`;

/** Build URL for an individual tag's notes page. The tag list itself
 *  lives in a modal opened from the sidebar — there's no /tags overview
 *  page anymore. */
export const buildTagPageUrl = (notebookShortId: string, tag: string): string =>
  `/app/notebooks/${notebookShortId}/tags/${encodeURIComponent(tag)}`;
