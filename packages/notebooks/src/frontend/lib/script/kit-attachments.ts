/**
 * `nb.attachments` — file attachments for the current notebook.
 *
 * Hard boundary: every operation runs against `ctx.notebookId`.
 * `listInNote()` filters the notebook list to only those referenced
 * (`attach://<shortId>`) by the current note's content.
 *
 * `insertIntoContent` writes directly to Y.Text — edit-mode only.
 * Other operations are HTTP-based and work in both modes.
 */
import { files } from "@valentinkolb/stdlib/browser";
import { apiClient } from "@/api/client";
import { assertActive, type KitAttachment, type KitAttachmentsAPI, type KitContext } from "./kit-types";

// =============================================================================
// Wire shape (matches AttachmentSchema in api/index.ts)
// =============================================================================

type ApiAttachment = {
  id: string;
  shortId: string;
  notebookId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "file";
  createdAt: string;
};

const toKitAttachment = (a: ApiAttachment): KitAttachment => ({
  id: a.shortId,
  filename: a.filename,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  kind: a.kind,
  createdAt: a.createdAt,
});

// `attach://<shortId>` references inside a markdown body. Mirrors
// the regex in `service/attachments.ts:extractIds`. Exposed
// client-side here so we don't have to round-trip through the
// service layer for `listInNote()`.
const ATTACH_REF_REGEX = /attach:\/\/([0-9a-zA-Z]{6})/g;

const extractAttachmentRefs = (content: string): string[] => {
  const set = new Set<string>();
  for (const match of content.matchAll(ATTACH_REF_REGEX)) {
    if (match[1]) set.add(match[1]);
  }
  return [...set];
};

// =============================================================================
// Factory
// =============================================================================

const READ_MODE_WRITE_ERROR = "nb.attachments.insertIntoContent is only available in edit mode";

export const createKitAttachmentsAPI = (ctx: KitContext): KitAttachmentsAPI => {
  const list = async (): Promise<KitAttachment[]> => {
    // The non-paginated `/:id/attachments` endpoint returns a flat
    // `Attachment[]` (via `respond(c, ok(...))`). The paginated
    // overview endpoint is a different route — we use the flat one
    // here because the runtime doesn't paginate attachments.
    const res = await apiClient[":id"].attachments.$get({ param: { id: ctx.notebookId } });
    if (!res.ok) throw new Error("nb.attachments.list: API call failed");
    const payload = await res.json();
    return payload.map(toKitAttachment);
  };

  const listInNote = async (): Promise<KitAttachment[]> => {
    // Use the live ytext when available so the result reflects
    // unsaved edits; fall back to the snapshot in read mode.
    const content = ctx.ytext ? ctx.ytext.toString() : ctx.note.content;
    const refs = new Set(extractAttachmentRefs(content));
    if (refs.size === 0) return [];
    const all = await list();
    return all.filter((a) => refs.has(a.id));
  };

  const get = async (shortId: string): Promise<KitAttachment | null> => {
    // Direct GET-by-id endpoint — O(1) lookup. Previously this did
    // a full list() + Array.find which made `for (id of ids)
    // nb.attachments.get(id)` O(N²) on notebook size.
    const res = await apiClient[":id"].attachments[":attId"].$get({
      param: { id: ctx.notebookId, attId: shortId },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("nb.attachments.get: API call failed");
    const att = await res.json();
    return toKitAttachment(att);
  };

  const upload = async (file: File | Blob, filename?: string): Promise<KitAttachment> => {
    assertActive(ctx);
    const name = filename ?? (file instanceof File ? file.name : undefined);
    if (!name) throw new Error("nb.attachments.upload: filename required for Blob inputs");
    const form = new FormData();
    form.append("file", file, name);
    const res = await apiClient[":id"].attachments.$post({ param: { id: ctx.notebookId } }, { init: { body: form } });
    if (!res.ok) {
      let message = "nb.attachments.upload: API call failed";
      try {
        const body = await res.json();
        if (body.message) message = `nb.attachments.upload: ${body.message}`;
      } catch {
        // Non-JSON error body — keep the generic message.
      }
      throw new Error(message);
    }
    const att = await res.json();
    return toKitAttachment(att);
  };

  const uploadFromPicker = async (opts?: { accept?: string; multiple?: boolean }): Promise<KitAttachment[]> => {
    if (opts?.multiple) {
      const picked = await files.showFileDialog({ accept: opts.accept, multiple: true });
      assertActive(ctx);
      const results: KitAttachment[] = [];
      // Sequential to keep order stable + bound concurrency to 1
      // upload at a time (matches the editor's AttachmentPicker).
      for (const f of picked) results.push(await upload(f));
      return results;
    }
    const picked = await files.showFileDialog({ accept: opts?.accept, multiple: false });
    assertActive(ctx);
    return [await upload(picked)];
  };

  const insertIntoContent = async (shortId: string): Promise<void> => {
    assertActive(ctx);
    if (ctx.mode !== "edit" || !ctx.ytext) throw new Error(READ_MODE_WRITE_ERROR);
    // Resolve the attachment to know its filename + kind, so we
    // emit the correct image-vs-file markdown form.
    const att = await get(shortId);
    assertActive(ctx);
    if (!att) throw new Error(`nb.attachments.insertIntoContent: attachment ${shortId} not found`);
    const md = att.kind === "image" ? `![${att.filename}](attach://${att.id})` : `[${att.filename}](attach://${att.id})`;
    const ytext = ctx.ytext;
    const current = ytext.toString();
    const sep = current.length === 0 ? "" : current.endsWith("\n") ? "" : "\n\n";
    ytext.insert(ytext.length, sep + md);
  };

  const remove = async (shortId: string): Promise<void> => {
    assertActive(ctx);
    const res = await apiClient[":id"].attachments[":attId"].$delete({
      param: { id: ctx.notebookId, attId: shortId },
    });
    if (!res.ok) throw new Error("nb.attachments.remove: API call failed");
  };

  return { list, listInNote, get, upload, uploadFromPicker, insertIntoContent, remove };
};
