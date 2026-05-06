/**
 * Browser-side helpers for the `attachment://<id>` URL scheme + the click
 * download flow. Used by both lib/editor decorations and the editor
 * components — neutral location to avoid backwards-layered imports.
 *
 * Server-safe regex copies live in `service/attachments.ts`.
 */
import { prompts } from "@valentinkolb/cloud/ui";

const ATTACHMENT_URL_RE = /^attachment:\/\/([0-9a-f-]{36})$/i;
const ATTACHMENT_REF_RE_GLOBAL = /attachment:\/\/([0-9a-f-]{36})/gi;

export const extractAttachmentId = (url: string): string | null =>
  url.match(ATTACHMENT_URL_RE)?.[1]?.toLowerCase() ?? null;

/** Extract all unique attachment ids referenced in a markdown body.
 *  Browser-safe twin of `service/attachments.ts:extractIds`. */
export const extractAttachmentIds = (md: string | null): string[] => {
  if (!md) return [];
  const ids = new Set<string>();
  for (const m of md.matchAll(ATTACHMENT_REF_RE_GLOBAL)) ids.add(m[1]!.toLowerCase());
  return Array.from(ids);
};

export const buildAttachmentContentUrl = (notebookId: string, attachmentId: string): string =>
  `/api/notebooks/${notebookId}/attachments/${attachmentId}/content`;

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
