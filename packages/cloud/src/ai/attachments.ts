/**
 * Non-image attachments live in the conversation VFS (/input), not in the
 * model context: the composer uploads the file, then sends an attachment
 * input part which becomes a marker text part in the user message. The model
 * reads the path and inspects the file with the bash tool; the chat UI parses
 * the same marker back into a chip. Browser-safe module.
 */

export type AiAttachmentRef = { path: string; mediaType: string; size: number };

const MARKER_RE = /<attachment path="([^"]+)" media-type="([^"]*)" size="(\d+)" \/>/g;

export const aiAttachmentMarker = (ref: AiAttachmentRef): string =>
  `<attachment path="${ref.path}" media-type="${ref.mediaType}" size="${ref.size}" />`;

/** Split a text part into plain text and attachment chips for rendering. */
export const parseAiAttachmentMarkers = (text: string): { text: string; attachments: AiAttachmentRef[] } => {
  const attachments: AiAttachmentRef[] = [];
  const stripped = text
    .replace(MARKER_RE, (_all, path: string, mediaType: string, size: string) => {
      attachments.push({ path, mediaType, size: Number(size) });
      return "";
    })
    .trim();
  return { text: stripped, attachments };
};

export const formatAiFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};
