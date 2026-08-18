import type { ChatAttachment, ChatModelOption, ChatSubmitInput } from "@k2b/ui";
import { AI_TURN_IMAGE_MAX_TOTAL_BYTES } from "../limits";
import type { AiResourceMarker } from "../resource-markers";
import type { AiPublicModelProfile, AiUserContentPart } from "../types";
import {
  type AiComposerAttachment,
  FILE_INPUT_ACCEPT,
  imageSrc,
  MAX_ATTACHMENTS,
  type PendingAiImage,
  type PendingAiVfsFile,
  readImageFile,
  readVfsFile,
} from "./message-utils";

export type { AiComposerAttachment } from "./message-utils";

export const AI_PASTED_TEXT_ATTACHMENT_THRESHOLD = 8_000;
export const AI_COMPOSER_TEXT_MAX_CHARS = 20_000;
const AI_COMPOSER_TEXT_MAX_BYTES = AI_COMPOSER_TEXT_MAX_CHARS * 4;
const AI_PASTED_TEXT_FILE_NAME = /^pasted-(?:text|[a-f0-9]{8})(?:-\d+)?\.txt$/i;

export type AiComposerSendInput = {
  message?: string;
  content?: AiUserContentPart[];
  files?: File[];
  resources?: AiResourceMarker[];
  storedFiles?: Array<{ path: string; mediaType: string; size: number; version: number }>;
};

export type AiComposerFileResult = {
  attachments: AiComposerAttachment[];
  errors: string[];
  discarded: number;
};

export const aiComposerFileAccept = FILE_INPUT_ACCEPT;

export const aiChatModelOptions = (profiles: readonly AiPublicModelProfile[]): ChatModelOption[] =>
  profiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    description: profile.model,
    image: profile.image,
    icon: profile.capabilities.includes("vision") ? "ti ti-photo-spark" : "ti ti-message",
    capabilities: profile.capabilities,
  }));

const isTextAttachment = (
  attachment: AiComposerAttachment,
): attachment is Extract<AiComposerAttachment, { kind: "file" | "stored-file" }> =>
  (attachment.kind === "file" || attachment.kind === "stored-file") &&
  (attachment.mediaType.startsWith("text/") || ["application/json", "application/xml", "application/yaml"].includes(attachment.mediaType));

const attachmentName = (attachment: AiComposerAttachment): string =>
  isTextAttachment(attachment) && AI_PASTED_TEXT_FILE_NAME.test(attachment.name) ? "Pasted text" : attachment.name;

export const aiChatAttachments = (
  attachments: readonly AiComposerAttachment[],
  options: { onShowText?: (attachment: AiComposerAttachment) => void | Promise<void> } = {},
): ChatAttachment[] =>
  attachments.map((attachment) => ({
    id: attachment.id,
    name: attachmentName(attachment),
    size: "size" in attachment ? attachment.size : undefined,
    kind: attachment.kind === "image" ? "image" : attachment.kind === "resource" ? "resource" : "file",
    icon:
      attachment.kind === "image"
        ? "ti ti-photo"
        : isTextAttachment(attachment)
          ? "ti ti-file-text"
          : attachment.icon.startsWith("ti ")
            ? attachment.icon
            : `ti ${attachment.icon}`,
    href: attachment.kind === "resource" ? attachment.href : undefined,
    previewUrl: attachment.kind === "image" ? imageSrc(attachment) : undefined,
    data: attachment,
    action:
      options.onShowText && isTextAttachment(attachment) && attachment.size <= AI_COMPOSER_TEXT_MAX_BYTES
        ? {
            id: "show-text",
            label: "Show in text field",
            icon: "ti ti-text-plus",
            onSelect: () => options.onShowText?.(attachment),
          }
        : undefined,
  }));

export const createAiPastedTextFile = (text: string): File =>
  new File([text], `pasted-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}.txt`, { type: "text/plain" });

export const shouldAttachAiPastedText = (text: string, currentTextLength = 0): boolean =>
  text.length >= AI_PASTED_TEXT_ATTACHMENT_THRESHOLD || currentTextLength + text.length > AI_COMPOSER_TEXT_MAX_CHARS;

const isAiComposerAttachment = (value: unknown): value is AiComposerAttachment => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiComposerAttachment>;
  return (
    ["image", "file", "stored-file", "resource"].includes(candidate.kind ?? "") &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string"
  );
};

export const aiComposerAttachmentRecords = (attachments: readonly ChatAttachment[]): AiComposerAttachment[] =>
  attachments.map((attachment) => attachment.data).filter(isAiComposerAttachment);

export const aiComposerSendInput = (input: ChatSubmitInput): AiComposerSendInput => {
  const attachments = aiComposerAttachmentRecords(input.attachments);
  const files = attachments.filter(
    (attachment): attachment is PendingAiImage | PendingAiVfsFile => attachment.kind === "image" || attachment.kind === "file",
  );
  const resources = attachments
    .filter((attachment) => attachment.kind === "resource")
    .map((attachment) => ({ ref: attachment.ref, title: attachment.name, icon: attachment.icon, href: attachment.href }));
  const storedFiles = attachments
    .filter((attachment) => attachment.kind === "stored-file")
    .map(({ path, mediaType, size, version }) => ({ path, mediaType, size, version }));
  const content =
    attachments.length > 0
      ? ([...(input.text ? [{ type: "text" as const, text: input.text }] : [])] satisfies AiUserContentPart[])
      : undefined;

  return {
    message: input.text || undefined,
    content: content?.length ? content : undefined,
    files: files.length ? files.map((attachment) => attachment.file) : undefined,
    resources: resources.length ? resources : undefined,
    storedFiles: storedFiles.length ? storedFiles : undefined,
  };
};

export const readAiComposerFiles = async (
  files: readonly File[],
  options: {
    acceptsImages?: boolean;
    currentCount?: number;
    currentImageBytes?: number;
  },
): Promise<AiComposerFileResult> => {
  const remaining = Math.max(0, MAX_ATTACHMENTS - (options.currentCount ?? 0));
  const candidates = files.slice(0, remaining);
  const errors: string[] = [];
  const attachments: AiComposerAttachment[] = [];
  let imageBytes = options.currentImageBytes ?? 0;

  for (const file of candidates) {
    if (file.type.startsWith("image/") && options.acceptsImages === false) {
      errors.push(`${file.name}: choose a Vision model or configure the view_image fallback.`);
      continue;
    }
    if (file.type.startsWith("image/") && imageBytes + file.size > AI_TURN_IMAGE_MAX_TOTAL_BYTES) {
      errors.push(`${file.name}: image attachments exceed the ${AI_TURN_IMAGE_MAX_TOTAL_BYTES / (1024 * 1024)} MB total limit.`);
      continue;
    }
    try {
      attachments.push(file.type.startsWith("image/") ? await readImageFile(file) : await readVfsFile(file));
      if (file.type.startsWith("image/")) imageBytes += file.size;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${file.name}: attachment failed.`);
    }
  }

  return {
    attachments,
    errors,
    discarded: Math.max(0, files.length - candidates.length),
  };
};
