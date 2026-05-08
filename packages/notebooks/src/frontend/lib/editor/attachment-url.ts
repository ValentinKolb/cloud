/**
 * Browser-side helpers for the `attach://<shortId>` URL scheme + the click
 * download flow. Used by both lib/editor decorations and the editor
 * components — neutral location to avoid backwards-layered imports.
 *
 * Server-safe regex copies live in `service/attachments.ts`.
 */
import { prompts } from "@valentinkolb/cloud/ui";

const ATTACHMENT_URL_RE = /^attach:\/\/([0-9a-zA-Z]{6})$/;
const ATTACHMENT_REF_RE_GLOBAL = /attach:\/\/([0-9a-zA-Z]{6})/g;

export const extractAttachmentId = (url: string): string | null =>
  url.match(ATTACHMENT_URL_RE)?.[1] ?? null;

/** Extract all unique attachment short-ids referenced in a markdown body.
 *  Browser-safe twin of `service/attachments.ts:extractIds`. */
export const extractAttachmentIds = (md: string | null): string[] => {
  if (!md) return [];
  const ids = new Set<string>();
  for (const m of md.matchAll(ATTACHMENT_REF_RE_GLOBAL)) ids.add(m[1]!);
  return Array.from(ids);
};

/** Notebook-scoped content URL — the API endpoint accepts either UUID
 *  or short-id, and we keep the short-id end-to-end so the rendered
 *  `<img src>` / `<a href>` stays short and copy-paste-friendly. */
export const buildAttachmentContentUrl = (notebookId: string, attachmentIdOrShortId: string): string =>
  `/api/notebooks/${notebookId}/attachments/${attachmentIdOrShortId}/content`;

/**
 * Shared click-to-download flow used by image widgets and file pills.
 * Confirms first to avoid accidental downloads while editing.
 */
export const confirmAndDownload = async (filename: string, url: string): Promise<void> => {
  const confirmed = await prompts.confirm(`Download "${filename}"?`, {
    title: "Download attachment",
    icon: "ti ti-download",
    confirmText: "Download",
  });
  if (!confirmed) return;
  window.open(url, "_blank", "noopener,noreferrer");
};
