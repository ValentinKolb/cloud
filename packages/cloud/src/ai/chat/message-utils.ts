import type { Message, Usage } from "@valentinkolb/nessi";
import { fileIcons } from "@valentinkolb/stdlib";
import { type AiAttachmentRef, parseAiAttachmentMarkers } from "../attachments";
import { assistantVisibleTextFromMessage } from "../timeline";
import type { AiStoredMessage, AiUserContentPart } from "../types";
import { AI_IMAGE_MEDIA_TYPES, isAiImageMediaType } from "../types";

type AssistantToolResultMessage = Extract<Message, { role: "tool_result" }>;

export type AiRetryMessageInput = {
  mode?: "retry" | "details" | "concise";
  content?: AiUserContentPart[];
};

export type AiForkMessageInput = {
  title?: string;
};

export type AiComposerAttachment =
  | {
      kind: "image";
      id: string;
      name: string;
      size: number;
      mediaType: string;
      data: string;
    }
  | {
      kind: "text";
      id: string;
      name: string;
      size: number;
      mediaType: string;
      text: string;
      icon: string;
    }
  | {
      // Any non-image file: uploaded into the conversation VFS (/input) on
      // send, referenced by path — never inlined into the model context.
      kind: "file";
      id: string;
      name: string;
      size: number;
      mediaType: string;
      file: File;
      icon: string;
    };

export type PendingAiImage = Extract<AiComposerAttachment, { kind: "image" }>;
export type PendingAiTextFile = Extract<AiComposerAttachment, { kind: "text" }>;
export type PendingAiVfsFile = Extract<AiComposerAttachment, { kind: "file" }>;
export type PendingAiAttachment = AiComposerAttachment;

export const MAX_ATTACHMENTS = 8;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const TEXT_FILE_MAX_BYTES = 256 * 1024;
export const VFS_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const ATTACHMENT_CONTEXT_MAX_CHARS = 18_000;
export const ATTACHMENT_CONTEXT_PREFIX = "Attached files for this message:";
export const TEXT_ATTACHMENT_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "html",
  "css",
  "yaml",
  "yml",
  "xml",
  "log",
] as const;
export const TEXT_ATTACHMENT_MEDIA_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "text/csv",
  "text/markdown",
  "text/plain",
]);
export const FILE_INPUT_ACCEPT = [
  ...AI_IMAGE_MEDIA_TYPES,
  "text/*",
  ...Array.from(TEXT_ATTACHMENT_MEDIA_TYPES),
  ...TEXT_ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

/** Seconds-granular work duration ("8s", "2m 14s") — stdlib's dates.formatDuration is deliberately minute-granular. */
export const formatWorkedDuration = (ms: number): string => {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
};

export const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
};

export const textFromMessage = (message: Message): string => {
  if (message.role === "tool_result") return typeof message.result === "string" ? message.result : JSON.stringify(message.result, null, 2);
  return message.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.type === "text") return part.text;
      if (part.type === "thinking") return part.thinking;
      return "";
    })
    .join("")
    .trim();
};

export const userVisibleTextFromMessage = (message: Message): string => {
  if (message.role !== "user") return textFromMessage(message);
  return message.content
    .map((part) => {
      const text = typeof part === "string" ? part : part.type === "text" ? part.text : "";
      if (text.startsWith(ATTACHMENT_CONTEXT_PREFIX)) return "";
      return parseAiAttachmentMarkers(text).text;
    })
    .join("")
    .trim();
};

/** VFS attachments referenced by this user message (rendered as chips). */
export const vfsAttachmentsFromMessage = (message: Message): (AiAttachmentRef & { name: string; icon: string })[] => {
  if (message.role !== "user") return [];
  return message.content.flatMap((part) => {
    const text = typeof part === "string" ? part : part.type === "text" ? part.text : "";
    return parseAiAttachmentMarkers(text).attachments.map((attachment) => {
      const name = attachment.path.slice(attachment.path.lastIndexOf("/") + 1);
      return { ...attachment, name, icon: fileIcons.getFileIcon({ name, type: "file", mimeType: attachment.mediaType }) };
    });
  });
};

export const isAttachmentContextPart = (part: AiUserContentPart): boolean => {
  const text = typeof part === "string" ? part : part.type === "text" ? part.text : "";
  if (text.startsWith(ATTACHMENT_CONTEXT_PREFIX)) return true;
  return parseAiAttachmentMarkers(text).attachments.length > 0 && !parseAiAttachmentMarkers(text).text;
};

export const userContentWithEditedVisibleText = (message: Message, text: string): AiUserContentPart[] => {
  if (message.role !== "user") return text.trim() ? [{ type: "text", text: text.trim() }] : [];
  const preserved = message.content.filter((part) => {
    if (typeof part === "string") return isAttachmentContextPart(part);
    return part.type === "file" || isAttachmentContextPart(part);
  });
  const visible = text.trim();
  return visible ? [{ type: "text", text: visible }, ...preserved] : preserved;
};

export const filePartsFromMessage = (message: Message) => {
  if (message.role !== "user") return [];
  return message.content.filter(
    (part): part is Extract<AiUserContentPart, { type: "file" }> => typeof part === "object" && part.type === "file",
  );
};

export const imageSrc = (part: { mediaType: string; data: string }) => `data:${part.mediaType};base64,${part.data}`;

export const fileExtension = (name: string): string => {
  const extension = name.toLowerCase().split(".").pop();
  return extension && extension !== name.toLowerCase() ? extension : "";
};

export const cleanFileName = (name: string): string => name.replace(/[\r\n]+/g, " ").trim() || "untitled";

export const isTextAttachmentFile = (file: File): boolean => {
  const mediaType = file.type.toLowerCase();
  if (mediaType.startsWith("text/") || TEXT_ATTACHMENT_MEDIA_TYPES.has(mediaType)) return true;
  const extension = fileExtension(file.name);
  return TEXT_ATTACHMENT_EXTENSIONS.some((candidate) => candidate === extension);
};

export const textAttachmentContext = (attachments: PendingAiTextFile[]): string | null => {
  if (!attachments.length) return null;
  let output = ATTACHMENT_CONTEXT_PREFIX;
  let remaining = ATTACHMENT_CONTEXT_MAX_CHARS - output.length;

  for (const attachment of attachments) {
    if (remaining <= 0) break;
    const header = `\n\n--- file: ${cleanFileName(attachment.name)} (${attachment.mediaType || "text/plain"}, ${formatBytes(attachment.size)}) ---\n`;
    if (header.length >= remaining) break;
    const available = remaining - header.length;
    const body = attachment.text.slice(0, available);
    output += header + body;
    remaining -= header.length + body.length;
    if (body.length < attachment.text.length && remaining > 0) {
      const suffix = "\n[File content truncated]\n";
      output += suffix.slice(0, remaining);
      remaining -= suffix.length;
    }
  }

  return output.trim();
};

export const textAttachmentSummariesFromMessage = (message: Message) => {
  if (message.role !== "user") return [];
  return message.content.flatMap((part) => {
    const text = typeof part === "string" ? part : part.type === "text" ? part.text : "";
    if (!text.startsWith(ATTACHMENT_CONTEXT_PREFIX)) return [];
    return text
      .split("\n")
      .map((line) => /^--- file: (.+?) \((.+?), (.+?)\) ---$/.exec(line))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => ({
        name: match[1] ?? "file",
        mediaType: match[2] ?? "text/plain",
        size: match[3] ?? "",
        icon: fileIcons.getFileIcon({ name: match[1] ?? "file", type: "file", mimeType: match[2] ?? "text/plain" }),
      }));
  });
};

export type AiLatestUsageSnapshot = {
  request: Usage;
  loop: Usage;
  modelProfileId: string | null;
};

export const latestUsageSnapshot = (messages: AiStoredMessage[]): AiLatestUsageSnapshot | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const entry = messages[i];
    const request = entry?.loopAggregate?.turns.findLast((turn) => Boolean(turn.usage))?.usage ?? entry?.usage;
    if (request) {
      return {
        request,
        loop: entry?.loopAggregate?.usage ?? entry?.usage ?? request,
        modelProfileId: entry?.modelProfileId ?? null,
      };
    }
  }
  return null;
};

export const latestUsage = (messages: AiStoredMessage[]): Usage | null => latestUsageSnapshot(messages)?.request ?? null;

export const latestLoopUsage = (messages: AiStoredMessage[]): Usage | null => latestUsageSnapshot(messages)?.loop ?? null;

export const copyTextFromMessage = (message: Message): string => {
  if (message.role === "user") return userVisibleTextFromMessage(message);
  if (message.role === "assistant") return assistantVisibleTextFromMessage(message);
  return textFromMessage(message);
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const isCardToolName = (name: string) => name === "card" || name === "cloud_card";

export const isSurveyToolName = (name: string) => name === "survey" || name === "cloud_survey";

export const displayToolName = (name: string) => {
  if (isCardToolName(name)) return "card";
  if (isSurveyToolName(name)) return "survey";
  return name;
};

export const jsonPreview = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const isWebSearchResultList = (value: unknown): value is { title?: unknown; url?: unknown; snippet?: unknown }[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item) && "url" in item);

const stringOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** Human-readable tool detail text: search results as a numbered list, page extracts as labeled fields, flat objects as key/value lines, JSON only as the fallback. */
export const formatToolDetailText = (toolName: string, value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;

  if (toolName === "web_search" && isWebSearchResultList(value)) {
    return value
      .map(
        (item, index) =>
          `${index + 1}. ${stringOf(item.title) || "Untitled"}\n   Url: ${stringOf(item.url)}\n   Snippet: ${stringOf(item.snippet)}`,
      )
      .join("\n\n");
  }

  if (toolName === "web_extract" && isRecord(value) && typeof value.content === "string") {
    const lines = [
      `Url: ${stringOf(value.url)}`,
      ...(value.title ? [`Title: ${stringOf(value.title)}`] : []),
      ...(value.description ? [`Description: ${stringOf(value.description)}`] : []),
    ];
    return `${lines.join("\n")}\n\n${value.content}${value.truncated === true ? " (truncated)" : ""}`;
  }

  // Flat objects read better as key/value lines than as JSON.
  if (isRecord(value) && Object.values(value).every((entry) => entry === null || typeof entry !== "object")) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${typeof entry === "string" ? entry : JSON.stringify(entry)}`)
      .join("\n");
  }

  return jsonPreview(value);
};

/** Short row description for a finished tool call. */
export const toolBlockSummary = (result: unknown): string => {
  if (Array.isArray(result)) return `${result.length} result${result.length === 1 ? "" : "s"}`;
  if (typeof result === "string") return result.slice(0, 80);
  if (isRecord(result)) {
    if (typeof result.message === "string" && result.message.trim()) return result.message.slice(0, 80);
    return Object.keys(result).slice(0, 4).join(", ");
  }
  return "";
};

export const toolResultSummary = (message: AssistantToolResultMessage | null | undefined): string => {
  if (!message) return "Tool result";
  const content = textFromMessage(message);
  const firstIssue = /Issues:\s*\n1\.\s*([^\n]+)/.exec(content)?.[1];
  if (firstIssue) return firstIssue;
  const firstLine = content.split("\n").find((line) => line.trim());
  if (firstLine) {
    const line = firstLine.trim();
    if (line.startsWith("{") || line.startsWith("[")) return message.isError ? "Tool failed" : "Tool result";
    return line.slice(0, 160);
  }
  return message.isError ? "Tool failed" : "Tool result";
};

export const readImageFile = (file: File): Promise<PendingAiImage> => {
  if (!isAiImageMediaType(file.type)) throw new Error(`${file.name} must be PNG, JPEG, WebP, or GIF.`);
  if (file.size > IMAGE_MAX_BYTES) throw new Error(`${file.name} is larger than ${formatBytes(IMAGE_MAX_BYTES)}.`);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({
        kind: "image",
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        mediaType: file.type,
        data,
      });
    };
    reader.readAsDataURL(file);
  });
};

/** Wrap any non-image file for deferred upload into the conversation VFS. */
export const readVfsFile = (file: File): PendingAiVfsFile => {
  if (file.size > VFS_FILE_MAX_BYTES) throw new Error(`${file.name} is larger than ${formatBytes(VFS_FILE_MAX_BYTES)}.`);
  const mediaType = file.type || "application/octet-stream";
  return {
    kind: "file",
    id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: cleanFileName(file.name),
    size: file.size,
    mediaType,
    file,
    icon: fileIcons.getFileIcon({ name: file.name, type: "file", mimeType: mediaType }),
  };
};

export const readTextFile = async (file: File): Promise<PendingAiTextFile> => {
  if (file.size > TEXT_FILE_MAX_BYTES) throw new Error(`${file.name} is larger than ${formatBytes(TEXT_FILE_MAX_BYTES)}.`);
  const mediaType = file.type || "text/plain";
  return {
    kind: "text",
    id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: cleanFileName(file.name),
    size: file.size,
    mediaType,
    text: await file.text(),
    icon: fileIcons.getFileIcon({ name: file.name, type: "file", mimeType: mediaType }),
  };
};
