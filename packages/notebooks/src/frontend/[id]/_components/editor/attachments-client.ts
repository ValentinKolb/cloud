/**
 * Attachment upload + insertion helpers — single entry point for every
 * upload trigger (drag-drop, paste, slash-command modal, footer button).
 *
 * Browser-only. Uses fetch to the notebooks API (same-origin via gateway).
 */
import type { EditorView } from "@codemirror/view";

// Re-exports — single import surface for components that want both upload
// flow and the click-to-download confirm. Underlying helpers live in
// `lib/editor/attachment-url.ts` (browser-safe, no editor deps).
export { buildAttachmentContentUrl, confirmAndDownload, extractAttachmentId, extractAttachmentIds } from "../../../lib/editor/attachment-url";

export type AttachmentRef = {
  id: string;
  kind: "image" | "file";
  filename: string;
};

export type Attachment = AttachmentRef & {
  notebookId: string;
  mimeType: string;
  sizeBytes: number;
  createdBy: string | null;
  createdAt: string;
};

/** POST a file to the notebooks API. Throws on non-2xx with the server message. */
export const uploadFile = async (notebookId: string, file: File): Promise<Attachment> => {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/attachments`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const msg = await res.json().then((d: { message?: string }) => d?.message).catch(() => null);
    throw new Error(msg ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as Attachment;
};

/** Human-readable file size — used by picker, detail panel, overview. */
export const formatBytes = (b: number): string => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

/** Markdown form for inserting an attachment reference. Image vs file. */
export const attachmentMarkdown = (att: AttachmentRef): string =>
  att.kind === "image" ? `![${att.filename}](attachment://${att.id})` : `[${att.filename}](attachment://${att.id})`;

/**
 * Insert an attachment reference at the current cursor position. Images
 * get padded with newlines so they land on their own line — non-image
 * pills go inline.
 */
export const insertAttachment = (view: EditorView, att: AttachmentRef): void => {
  const md = attachmentMarkdown(att);
  const { from, to } = view.state.selection.main;
  let text = md;
  if (att.kind === "image") {
    const lineStart = view.state.doc.lineAt(from).from;
    const before = view.state.sliceDoc(lineStart, from);
    const after = view.state.sliceDoc(from, view.state.doc.lineAt(from).to);
    if (before.trim().length > 0) text = `\n\n${text}`;
    if (after.trim().length > 0) text = `${text}\n`;
  }
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
};

/** Upload a file and insert its reference at the cursor in one go. */
export const uploadAndInsert = async (view: EditorView, notebookId: string, file: File): Promise<void> => {
  const att = await uploadFile(notebookId, file);
  insertAttachment(view, att);
};
