import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { Accessor, Setter } from "solid-js";
import { createSignal, onCleanup } from "solid-js";
import { apiClient } from "../../api/client";
import type { CreateAttachmentLinkInput, CreatedAttachmentLink, MailDraft } from "../../contracts";
import { readApiError } from "./api-response";
import { promptAttachmentLinkOptions } from "./attachment-link-ui";
import type { MailComposerUpload } from "./MailComposerAttachments";
import type { createMailComposerTransition } from "./mail-composer-transition";

export const createMailComposerAttachmentManager = (options: {
  mailboxId: string;
  draft: Accessor<MailDraft | null>;
  setDraft: Setter<MailDraft | null>;
  editable: Accessor<boolean>;
  persist: () => Promise<MailDraft | null>;
  serializeDraftMutation: <T>(operation: () => Promise<T>) => Promise<T>;
  transition: ReturnType<typeof createMailComposerTransition>;
  format: Accessor<"plain" | "markdown">;
  setBody: Setter<string>;
  isDisposed: () => boolean;
}) => {
  const [uploads, setUploads] = createSignal<MailComposerUpload[]>([]);
  const uploadControllers = new Map<File, AbortController>();

  const uploadFile = async (file: File) => {
    const controller = new AbortController();
    uploadControllers.get(file)?.abort();
    uploadControllers.set(file, controller);
    setUploads((current) => [
      ...current.filter((entry) => entry.file !== file),
      { file, progress: 0, error: null, uploadId: null, draftId: null },
    ]);
    try {
      const saved = await options.persist();
      if (!saved) throw new Error("Save the draft before attaching files.");
      const createResponse = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["attachment-uploads"].$post(
        {
          param: { mailboxId: options.mailboxId, draftId: saved.id },
          json: { filename: file.name, contentType: file.type || "application/octet-stream", byteLength: file.size },
        },
        { init: { signal: controller.signal } },
      );
      if (!createResponse.ok) throw new Error(await readApiError(createResponse, `Failed to attach ${file.name}`));
      const upload = await createResponse.json();
      setUploads((current) => current.map((entry) => (entry.file === file ? { ...entry, uploadId: upload.id, draftId: saved.id } : entry)));
      for (let offset = 0; offset < file.size; offset += upload.chunkSize) {
        const chunk = file.slice(offset, Math.min(file.size, offset + upload.chunkSize));
        const response = await fetch(
          `/api/mail/mailboxes/${options.mailboxId}/drafts/${saved.id}/attachment-uploads/${upload.id}?offset=${offset}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/octet-stream" },
            body: chunk,
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(await readApiError(response, `Failed to upload ${file.name}`));
        const progress = file.size === 0 ? 100 : Math.round((Math.min(file.size, offset + chunk.size) / file.size) * 100);
        setUploads((current) => current.map((entry) => (entry.file === file ? { ...entry, progress } : entry)));
      }
      await options.serializeDraftMutation(async () => {
        const latest = options.draft() ?? saved;
        const finalizeResponse = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["attachment-uploads"][
          ":uploadId"
        ].finalize.$post(
          {
            param: { mailboxId: options.mailboxId, draftId: saved.id, uploadId: upload.id },
            json: { expectedRevision: latest.revision },
          },
          { init: { signal: controller.signal } },
        );
        if (!finalizeResponse.ok) throw new Error(await readApiError(finalizeResponse, `Failed to finalize ${file.name}`));
        options.setDraft(await finalizeResponse.json());
      });
      setUploads((current) => current.filter((entry) => entry.file !== file));
    } finally {
      if (uploadControllers.get(file) === controller) uploadControllers.delete(file);
    }
  };

  const cancelUpload = async (upload: MailComposerUpload) => {
    uploadControllers.get(upload.file)?.abort();
    uploadControllers.delete(upload.file);
    if (upload.uploadId && upload.draftId) {
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["attachment-uploads"][":uploadId"].$delete({
        param: { mailboxId: options.mailboxId, draftId: upload.draftId, uploadId: upload.uploadId },
      });
      if (!response.ok) throw new Error(await readApiError(response, `Failed to cancel upload for ${upload.file.name}`));
    }
    setUploads((current) => current.filter((entry) => entry.file !== upload.file));
  };

  const retryUpload = async (upload: MailComposerUpload) => {
    try {
      await cancelUpload(upload);
      await uploadFile(upload.file);
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : `Failed to retry ${upload.file.name}`);
    }
  };

  const addFiles = async (files: File[]) => {
    for (const file of files) {
      try {
        await uploadFile(file);
      } catch (error) {
        if (options.isDisposed() || (error instanceof DOMException && error.name === "AbortError")) return;
        setUploads((current) =>
          current.map((entry) =>
            entry.file === file ? { ...entry, error: error instanceof Error ? error.message : "Upload failed" } : entry,
          ),
        );
      }
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!options.editable()) return;
    const reservation = options.transition.reserve("attachment");
    if (!reservation) return;
    try {
      await options.serializeDraftMutation(async () => {
        const currentDraft = options.draft();
        if (!currentDraft) return;
        const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].attachments[":attachmentId"].$delete({
          param: { mailboxId: options.mailboxId, draftId: currentDraft.id, attachmentId },
          query: { expectedRevision: String(currentDraft.revision) },
        });
        if (!response.ok) return await prompts.error(await readApiError(response, "Failed to remove attachment"));
        options.setDraft(await response.json());
      });
    } finally {
      options.transition.release(reservation);
    }
  };

  const shareAttachment = mutations.create<CreatedAttachmentLink, { attachmentId: string; input: CreateAttachmentLinkInput }>({
    mutation: async ({ attachmentId, input }, { abortSignal }) => {
      const currentDraft = options.draft();
      if (!currentDraft) throw new Error("Save the draft before sharing an attachment.");
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].attachments[":attachmentId"].links.$post(
        {
          param: { mailboxId: options.mailboxId, draftId: currentDraft.id, attachmentId },
          json: input,
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to share attachment"));
      return response.json();
    },
    onSuccess: ({ link, url }) => {
      const label = link.filename ?? "Download attachment";
      const insertion = options.format() === "markdown" ? `[${label.replaceAll("]", "\\]")}](${url})` : url;
      options.setBody((current) => `${current}${current.endsWith("\n") || !current ? "" : "\n\n"}${insertion}`);
      toast.success("Public attachment link inserted");
    },
    onError: (error) => prompts.error(error.message),
  });

  const insertAttachmentLink = async (attachmentId: string) => {
    if (!options.editable()) return;
    const reservation = options.transition.reserve("attachment");
    if (!reservation) return;
    try {
      const input = await promptAttachmentLinkOptions();
      if (input && !options.isDisposed()) await shareAttachment.mutate({ attachmentId, input });
    } finally {
      options.transition.release(reservation);
    }
  };

  onCleanup(() => {
    for (const controller of uploadControllers.values()) controller.abort();
    uploadControllers.clear();
    shareAttachment.abort();
  });

  return {
    uploads,
    addFiles,
    cancelUpload,
    retryUpload,
    removeAttachment,
    insertAttachmentLink,
    shareLoading: shareAttachment.loading,
  };
};
