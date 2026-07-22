import { Placeholder, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { CreateAttachmentLinkInput, CreatedAttachmentLink } from "../../contracts";
import { readApiError } from "./api-response";
import { promptAttachmentLinkOptions } from "./attachment-link-ui";
import { attachmentPreviewKind } from "./mail-message-presentation";

const TEXT_PREVIEW_BYTES = 256 * 1024;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type Attachment = {
  id: string;
  filename: string | null;
  contentType: string;
  sizeBytes: number;
};

export default function MailMessageAttachments(props: {
  mailboxId: string;
  messageId: string;
  attachments: Attachment[];
  canShare?: boolean;
}) {
  const [previewId, setPreviewId] = createSignal<string | null>(null);
  const [textPreview, setTextPreview] = createSignal("");
  const baseUrl = (attachment: Attachment) =>
    `/api/mail/mailboxes/${props.mailboxId}/messages/${props.messageId}/attachments/${attachment.id}`;

  const loadText = mutations.create<string, Attachment>({
    mutation: async (attachment, { abortSignal }) => {
      const response = await fetch(`${baseUrl(attachment)}?inline=true&offset=0&length=${TEXT_PREVIEW_BYTES}`, {
        signal: abortSignal,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not preview attachment"));
      return response.text();
    },
    onSuccess: setTextPreview,
    onError: (error) => prompts.error(error.message),
  });

  const togglePreview = (attachment: Attachment) => {
    if (previewId() === attachment.id) {
      loadText.abort();
      setPreviewId(null);
      setTextPreview("");
      return;
    }
    loadText.abort();
    setPreviewId(attachment.id);
    setTextPreview("");
    if (attachmentPreviewKind(attachment.contentType, attachment.sizeBytes) === "text" && attachment.sizeBytes > 0) {
      loadText.mutate(attachment);
    }
  };

  const createLink = mutations.create<CreatedAttachmentLink, { attachment: Attachment; input: CreateAttachmentLinkInput }>({
    mutation: async ({ attachment, input }) => {
      const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"].attachments[":attachmentId"].links.$post({
        param: { mailboxId: props.mailboxId, messageId: props.messageId, attachmentId: attachment.id },
        json: input,
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not create attachment link"));
      return response.json();
    },
    onSuccess: async ({ url }) => {
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Public link copied");
      } catch {
        await prompts.alert(url, { title: "Public attachment link" });
      }
    },
    onError: (error) => prompts.error(error.message),
  });

  const shareAttachment = async (attachment: Attachment) => {
    const input = await promptAttachmentLinkOptions();
    if (input) createLink.mutate({ attachment, input });
  };

  return (
    <div class="mt-4">
      <p class="mb-1.5 text-xs font-medium text-dimmed">Attachments</p>
      <div class="flex flex-col gap-1.5">
        <For each={props.attachments}>
          {(attachment) => {
            const kind = attachmentPreviewKind(attachment.contentType, attachment.sizeBytes);
            const inlineUrl = `${baseUrl(attachment)}?inline=true`;
            return (
              <div class="min-w-0">
                <div class="flex min-h-8 min-w-0 items-center gap-1.5 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-2 py-0.5">
                  <i class="ti ti-paperclip shrink-0 text-sm text-dimmed" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate text-xs font-medium text-primary">
                    {attachment.filename ?? attachment.contentType}
                  </span>
                  <span class="shrink-0 text-xs text-dimmed">{formatBytes(attachment.sizeBytes)}</span>
                  <Show when={kind}>
                    <button
                      type="button"
                      class="mail-attachment-preview btn-simple"
                      aria-expanded={previewId() === attachment.id}
                      onClick={() => togglePreview(attachment)}
                    >
                      <i class={`ti ${previewId() === attachment.id ? "ti-eye-off" : "ti-eye"}`} aria-hidden="true" />
                      {previewId() === attachment.id ? "Hide" : "Preview"}
                    </button>
                  </Show>
                  <Show when={props.canShare}>
                    <button
                      type="button"
                      class="icon-btn !h-7 !w-7 !p-0 text-sm"
                      aria-label={`Share ${attachment.filename ?? "attachment"}`}
                      disabled={createLink.loading()}
                      onClick={() => void shareAttachment(attachment)}
                    >
                      <i class={`ti ${createLink.loading() ? "ti-loader-2 animate-spin" : "ti-link"}`} aria-hidden="true" />
                    </button>
                  </Show>
                  <a
                    class="icon-btn !h-7 !w-7 !p-0 text-sm"
                    href={baseUrl(attachment)}
                    aria-label={`Download ${attachment.filename ?? "attachment"}`}
                  >
                    <i class="ti ti-download" aria-hidden="true" />
                    <span class="sr-only">Download {attachment.filename ?? "attachment"}</span>
                  </a>
                </div>
                <Show when={previewId() === attachment.id && kind}>
                  {(activeKind) => (
                    <div class="mt-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-2">
                      <Show when={activeKind() === "image"}>
                        <img
                          src={inlineUrl}
                          alt={attachment.filename ?? "Image attachment"}
                          class="mx-auto max-h-[60vh] max-w-full object-contain"
                          loading="lazy"
                          referrerpolicy="no-referrer"
                        />
                      </Show>
                      <Show when={activeKind() === "pdf"}>
                        <iframe
                          src={inlineUrl}
                          title={attachment.filename ?? "PDF attachment"}
                          class="h-[min(65vh,48rem)] w-full border-0"
                          sandbox=""
                          referrerpolicy="no-referrer"
                        />
                      </Show>
                      <Show when={activeKind() === "audio"}>
                        <audio src={inlineUrl} controls preload="metadata" class="w-full" />
                      </Show>
                      <Show when={activeKind() === "video"}>
                        <video src={inlineUrl} controls preload="metadata" class="mx-auto max-h-[60vh] max-w-full" />
                      </Show>
                      <Show when={activeKind() === "text"}>
                        <Show when={!loadText.loading()} fallback={<Placeholder state="loading" title="Loading preview" />}>
                          <pre class="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words text-xs text-primary">{textPreview()}</pre>
                        </Show>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
