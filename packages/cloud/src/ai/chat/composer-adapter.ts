import type { ChatAttachment, ChatModelOption, ChatSubmitInput } from "@k2b/ui";
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

export type AiComposerSendInput = {
  message?: string;
  content?: AiUserContentPart[];
  files?: File[];
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

export const aiChatAttachments = (attachments: readonly AiComposerAttachment[]): ChatAttachment[] =>
  attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    kind: attachment.kind === "image" ? "image" : "file",
    icon: attachment.kind === "image" ? "ti ti-photo" : `ti ${attachment.icon}`,
    previewUrl: attachment.kind === "image" ? imageSrc(attachment) : undefined,
    data: attachment,
  }));

const isAiComposerAttachment = (value: unknown): value is AiComposerAttachment => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiComposerAttachment>;
  return (
    (candidate.kind === "image" || candidate.kind === "text" || candidate.kind === "file") &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string"
  );
};

export const aiComposerAttachmentRecords = (attachments: readonly ChatAttachment[]): AiComposerAttachment[] =>
  attachments.map((attachment) => attachment.data).filter(isAiComposerAttachment);

export const aiComposerSendInput = (input: ChatSubmitInput): AiComposerSendInput => {
  const attachments = aiComposerAttachmentRecords(input.attachments);
  const images = attachments.filter((attachment): attachment is PendingAiImage => attachment.kind === "image");
  const files = attachments.filter((attachment): attachment is PendingAiVfsFile => attachment.kind === "file");
  const content =
    attachments.length > 0
      ? ([
          ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
          ...images.map((image) => ({
            type: "file" as const,
            data: image.data,
            mediaType: image.mediaType,
          })),
        ] satisfies AiUserContentPart[])
      : undefined;

  return {
    message: input.text || undefined,
    content: content?.length ? content : undefined,
    files: files.length ? files.map((attachment) => attachment.file) : undefined,
  };
};

export const readAiComposerFiles = async (
  files: readonly File[],
  options: {
    supportsVision: boolean;
    currentCount?: number;
  },
): Promise<AiComposerFileResult> => {
  const remaining = Math.max(0, MAX_ATTACHMENTS - (options.currentCount ?? 0));
  const candidates = files.slice(0, remaining);
  const errors: string[] = [];
  const attachments: AiComposerAttachment[] = [];

  for (const file of candidates) {
    if (file.type.startsWith("image/") && !options.supportsVision) {
      errors.push(`${file.name}: choose a vision-capable model before attaching images.`);
      continue;
    }
    try {
      attachments.push(file.type.startsWith("image/") ? await readImageFile(file) : await readVfsFile(file));
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
