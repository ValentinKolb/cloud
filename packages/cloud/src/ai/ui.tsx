import type { Message, Usage } from "@valentinkolb/nessi";
import { fileIcons } from "@valentinkolb/stdlib";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { markdown } from "../shared";
import { Dropdown, type DropdownItem, MarkdownView, Placeholder, toast } from "../ui";
import type { AiPublicModelProfile, AiStoredMessage, AiUiBlock, AiUserContentPart } from "./types";
import { AI_IMAGE_MEDIA_TYPES, isAiImageMediaType } from "./types";

type AssistantMessage = Extract<Message, { role: "assistant" }>;

export type AiSlashCommandContext = {
  setDraft: (value: string) => void;
  submit: () => void;
  focus: () => void;
};

export type AiSlashCommand = {
  name: string;
  description: string;
  icon?: string;
  action: (ctx: AiSlashCommandContext) => void | Promise<void>;
};

export type AiComposerSendInput = {
  message?: string;
  content?: AiUserContentPart[];
};

type PendingAiImage = {
  kind: "image";
  id: string;
  name: string;
  size: number;
  mediaType: string;
  data: string;
};

type PendingAiTextFile = {
  kind: "text";
  id: string;
  name: string;
  size: number;
  mediaType: string;
  text: string;
  icon: string;
};

type PendingAiAttachment = PendingAiImage | PendingAiTextFile;

type ApprovalUiBlock = Extract<AiUiBlock, { type: "approval_request" }>;
type FrontendToolUiBlock = Extract<AiUiBlock, { type: "frontend_tool" }>;
type ToolCallUiBlock = Extract<AiUiBlock, { type: "tool_call" }>;

const MAX_ATTACHMENTS = 8;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const TEXT_FILE_MAX_BYTES = 256 * 1024;
const ATTACHMENT_CONTEXT_MAX_CHARS = 18_000;
const ATTACHMENT_CONTEXT_PREFIX = "Attached files for this message:";
const TEXT_ATTACHMENT_EXTENSIONS = [
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
const TEXT_ATTACHMENT_MEDIA_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "text/csv",
  "text/markdown",
  "text/plain",
]);
const FILE_INPUT_ACCEPT = [
  ...AI_IMAGE_MEDIA_TYPES,
  "text/*",
  ...Array.from(TEXT_ATTACHMENT_MEDIA_TYPES),
  ...TEXT_ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
};

const textFromMessage = (message: Message): string => {
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

const userVisibleTextFromMessage = (message: Message): string => {
  if (message.role !== "user") return textFromMessage(message);
  return message.content
    .map((part) => {
      if (typeof part === "string") return part.startsWith(ATTACHMENT_CONTEXT_PREFIX) ? "" : part;
      if (part.type === "text") return part.text.startsWith(ATTACHMENT_CONTEXT_PREFIX) ? "" : part.text;
      return "";
    })
    .join("")
    .trim();
};

const assistantBlocks = (message: Message): AssistantMessage["content"] => (message.role === "assistant" ? message.content : []);

const assistantVisibleBlocks = (message: Message) => {
  const blocks = assistantBlocks(message);
  return [
    ...blocks.filter((part): part is Extract<(typeof blocks)[number], { type: "thinking" }> => part.type === "thinking"),
    ...blocks.filter((part): part is Extract<(typeof blocks)[number], { type: "text" }> => part.type === "text"),
    ...blocks.filter((part): part is Extract<(typeof blocks)[number], { type: "tool_call" }> => part.type === "tool_call"),
  ];
};

const filePartsFromMessage = (message: Message) => {
  if (message.role !== "user") return [];
  return message.content.filter(
    (part): part is Extract<AiUserContentPart, { type: "file" }> => typeof part === "object" && part.type === "file",
  );
};

const imageSrc = (part: { mediaType: string; data: string }) => `data:${part.mediaType};base64,${part.data}`;

const fileExtension = (name: string): string => {
  const extension = name.toLowerCase().split(".").pop();
  return extension && extension !== name.toLowerCase() ? extension : "";
};

const cleanFileName = (name: string): string => name.replace(/[\r\n]+/g, " ").trim() || "untitled";

const isTextAttachmentFile = (file: File): boolean => {
  const mediaType = file.type.toLowerCase();
  if (mediaType.startsWith("text/") || TEXT_ATTACHMENT_MEDIA_TYPES.has(mediaType)) return true;
  const extension = fileExtension(file.name);
  return TEXT_ATTACHMENT_EXTENSIONS.some((candidate) => candidate === extension);
};

const textAttachmentContext = (attachments: PendingAiTextFile[]): string | null => {
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

const textAttachmentSummariesFromMessage = (message: Message) => {
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

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

const jsonPreview = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toneClass = (tone: unknown) => {
  if (tone === "blue") return "border-blue-200 bg-blue-50/65 text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/25 dark:text-blue-100";
  if (tone === "green")
    return "border-emerald-200 bg-emerald-50/65 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-100";
  if (tone === "amber")
    return "border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-100";
  if (tone === "red") return "border-red-200 bg-red-50/70 text-red-950 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-100";
  if (tone === "teal") return "border-cyan-200 bg-teal-50/70 text-cyan-950 dark:border-cyan-900/70 dark:bg-cyan-950/25 dark:text-cyan-100";
  return "border-zinc-200 bg-white text-primary dark:border-zinc-800 dark:bg-zinc-900";
};

const latestUsage = (messages: AiStoredMessage[]): Usage | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = messages[i]?.usage;
    if (usage) return usage;
  }
  return null;
};

const readImageFile = (file: File): Promise<PendingAiImage> => {
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

const readTextFile = async (file: File): Promise<PendingAiTextFile> => {
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

export function AiContextIndicator(props: { usage?: Usage | null; contextWindow?: number }) {
  const total = () => props.usage?.total ?? 0;
  const windowSize = () => props.contextWindow;
  const percent = () => {
    const contextWindow = windowSize();
    if (!contextWindow || total() <= 0) return null;
    return Math.round((total() / contextWindow) * 100);
  };
  const label = () => {
    if (total() > 0) return formatTokens(total());
    if (windowSize()) return formatTokens(windowSize()!);
    return "context";
  };
  const remaining = () => {
    const contextWindow = windowSize();
    if (!contextWindow) return null;
    return Math.max(0, contextWindow - total());
  };

  return (
    <div class="group relative inline-flex">
      <button
        type="button"
        class={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs tabular-nums outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-cyan-300 dark:hover:bg-zinc-800 ${
          (percent() ?? 0) >= 85 ? "text-amber-600 dark:text-amber-300" : "text-dimmed"
        }`}
        aria-describedby="ai-context-popover"
      >
        <i class="ti ti-brain text-sm" aria-hidden="true" />
        <span>{label()}</span>
        <Show when={percent() !== null}>
          <span class="opacity-75">({percent()}%)</span>
        </Show>
      </button>
      <div
        id="ai-context-popover"
        role="tooltip"
        class="pointer-events-none invisible absolute bottom-full right-0 z-30 mb-2 w-64 rounded-lg border border-zinc-200 bg-white p-3 text-xs text-secondary opacity-0 shadow-[var(--theme-shadow-float)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <p class="font-medium text-primary">Context</p>
        <div class="mt-2 space-y-1">
          <p class="flex justify-between gap-3">
            <span>Used</span>
            <span class="tabular-nums text-primary">{total() > 0 ? total().toLocaleString() : "Unknown"}</span>
          </p>
          <p class="flex justify-between gap-3">
            <span>Window</span>
            <span class="tabular-nums text-primary">{windowSize() ? windowSize()!.toLocaleString() : "Not configured"}</span>
          </p>
          <Show when={remaining() !== null}>
            <p class="flex justify-between gap-3">
              <span>Remaining</span>
              <span class="tabular-nums text-primary">{remaining()!.toLocaleString()}</span>
            </p>
          </Show>
        </div>
        <p class="mt-2 text-dimmed">Cloud AI can compact old chat context before the model hits the context limit.</p>
      </div>
    </div>
  );
}

function UserMessageBubble(props: { message: Message }) {
  const text = () => userVisibleTextFromMessage(props.message);
  const images = () => filePartsFromMessage(props.message).filter((part) => part.mediaType.startsWith("image/"));
  const textAttachments = () => textAttachmentSummariesFromMessage(props.message);

  return (
    <div class="flex justify-end px-3 py-2">
      <div class="flex max-w-[min(44rem,88%)] flex-col items-end gap-2">
        <Show when={images().length > 0 || textAttachments().length > 0}>
          <div class="flex flex-wrap justify-end gap-2">
            <For each={images()}>
              {(part) => (
                <img
                  src={imageSrc(part)}
                  alt="Uploaded image"
                  class="max-h-56 max-w-72 rounded-md border border-zinc-200 object-contain dark:border-zinc-800"
                />
              )}
            </For>
            <For each={textAttachments()}>
              {(attachment) => (
                <div
                  class="grid h-14 w-14 place-items-center rounded-md border border-zinc-200 bg-zinc-100 px-1 text-center dark:border-zinc-800 dark:bg-zinc-900"
                  title={`${attachment.name}${attachment.size ? `, ${attachment.size}` : ""}`}
                >
                  <div class="min-w-0">
                    <i class={`ti ${attachment.icon} text-lg`} aria-hidden="true" />
                    <p class="mt-0.5 w-12 truncate text-[10px] leading-3 text-dimmed">{attachment.name}</p>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={text()}>
          <div class="paper rounded-br-sm px-3 py-2 text-sm leading-6 text-primary">
            <p class="whitespace-pre-wrap">{text()}</p>
          </div>
        </Show>
      </div>
    </div>
  );
}

function AssistantThinkingBlock(props: { text: string; streaming?: boolean }) {
  return (
    <p class="mb-2 inline-flex items-center gap-1.5 text-xs text-dimmed">
      <i class="ti ti-sparkles text-sm text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
      <span>{props.streaming ? "Thinking" : props.text ? "Reasoning captured" : "Thinking"}</span>
      <Show when={props.streaming}>
        <span class="inline-flex items-center gap-0.5" aria-hidden="true">
          <span class="h-1 w-1 animate-pulse rounded-full bg-current" />
          <span class="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
          <span class="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
        </span>
      </Show>
    </p>
  );
}

function CloudCardBlock(props: { args: unknown }) {
  const card = () => (isRecord(props.args) ? props.args : null);
  const kind = () => card()?.kind;
  const title = () => String(card()?.title ?? "Card");
  const caption = () => (typeof card()?.caption === "string" ? String(card()!.caption) : "");
  const data = () => (Array.isArray(card()?.data) ? (card()!.data as unknown[]).filter(isRecord) : []);
  const maxValue = () => Math.max(1, ...data().map((entry) => (typeof entry.value === "number" ? entry.value : 0)));

  return (
    <div class={`my-2 max-w-xl rounded-md border p-2.5 ${toneClass(card()?.tone)}`}>
      <Show
        when={card()}
        fallback={
          <pre class="max-h-52 overflow-auto rounded-md bg-zinc-950/5 p-2 text-xs text-primary dark:bg-white/5">
            {jsonPreview(props.args)}
          </pre>
        }
      >
        <div class="flex items-start gap-2">
          <span class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/60 text-cyan-700 dark:bg-white/10 dark:text-cyan-200">
            <i class="ti ti-sparkles text-base" aria-hidden="true" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">{title()}</p>
            <Show when={kind() === "stat_card"}>
              <p class="mt-2 text-3xl font-semibold tracking-normal">{String(card()?.value ?? "")}</p>
              <Show when={isRecord(card()?.trend)}>
                <p class="mt-1 inline-flex items-center gap-1 rounded-md bg-white/55 px-1.5 py-0.5 text-xs dark:bg-white/10">
                  <i
                    class={`ti ${
                      (card()?.trend as Record<string, unknown>).direction === "up"
                        ? "ti-trending-up"
                        : (card()?.trend as Record<string, unknown>).direction === "down"
                          ? "ti-trending-down"
                          : "ti-minus"
                    } text-sm`}
                    aria-hidden="true"
                  />
                  {String((card()?.trend as Record<string, unknown>).value ?? "")}
                  <span class="opacity-70">{String((card()?.trend as Record<string, unknown>).label ?? "")}</span>
                </p>
              </Show>
            </Show>
            <Show when={kind() === "chart"}>
              <div class="mt-3 space-y-2">
                <For each={data()}>
                  {(entry) => {
                    const value = () => (typeof entry.value === "number" ? entry.value : 0);
                    return (
                      <div class="grid grid-cols-[minmax(5rem,1fr)_3fr_auto] items-center gap-2 text-xs">
                        <span class="truncate opacity-80">{String(entry.label ?? "")}</span>
                        <div class="h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                          <div
                            class="h-full rounded-full bg-cyan-500 dark:bg-cyan-300"
                            style={{ width: `${Math.max(3, Math.round((value() / maxValue()) * 100))}%` }}
                          />
                        </div>
                        <span class="tabular-nums opacity-80">{value().toLocaleString()}</span>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
            <Show when={kind() === "table"}>
              <div class="mt-3 overflow-x-auto">
                <table class="min-w-full text-left text-xs">
                  <thead class="border-b border-current/10">
                    <tr>
                      <For each={Array.isArray(card()?.columns) ? (card()!.columns as unknown[]) : []}>
                        {(column) => <th class="px-2 py-1 font-medium opacity-75">{String(column)}</th>}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={Array.isArray(card()?.rows) ? (card()!.rows as unknown[]) : []}>
                      {(row) => (
                        <tr class="border-b border-current/10 last:border-b-0">
                          <For each={Array.isArray(row) ? row : []}>{(cell) => <td class="px-2 py-1.5">{String(cell)}</td>}</For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <Show when={caption()}>
              <p class="mt-2 text-xs opacity-70">{caption()}</p>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

function CloudSurveyBlock(props: { args: unknown; disabled?: boolean; onSubmit?: (result: unknown) => void | Promise<void> }) {
  const survey = () => (isRecord(props.args) ? props.args : null);
  const questions = () => (Array.isArray(survey()?.questions) ? (survey()!.questions as unknown[]).filter(isRecord) : []);
  const [answers, setAnswers] = createSignal<Record<string, unknown>>({});
  const [error, setError] = createSignal<string | null>(null);
  const [submitted, setSubmitted] = createSignal(false);

  const setAnswer = (id: string, value: unknown) => setAnswers((prev) => ({ ...prev, [id]: value }));
  const toggleAnswer = (id: string, value: string, checked: boolean) => {
    const current = Array.isArray(answers()[id]) ? ([...(answers()[id] as string[])] as string[]) : [];
    setAnswer(id, checked ? [...current, value] : current.filter((entry) => entry !== value));
  };
  const submit = async () => {
    const missing = questions().find((question) => {
      if (!question.required) return false;
      const value = answers()[String(question.id ?? "")];
      return Array.isArray(value) ? value.length === 0 : value === undefined || value === "";
    });
    if (missing) {
      setError("Please answer all required questions.");
      return;
    }
    setError(null);
    setSubmitted(true);
    await props.onSubmit?.({ submitted: true, answers: answers() });
  };

  return (
    <div class="my-2 max-w-xl rounded-md border border-cyan-200 bg-white/80 p-2.5 dark:border-cyan-900/70 dark:bg-zinc-900/80">
      <div class="flex items-start gap-2">
        <span class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-200">
          <i class="ti ti-forms text-base" aria-hidden="true" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-primary">{String(survey()?.title ?? "Survey")}</p>
          <Show when={typeof survey()?.description === "string"}>
            <p class="mt-1 text-xs text-secondary">{String(survey()?.description)}</p>
          </Show>

          <div class="mt-3 space-y-3">
            <For each={questions()}>
              {(question) => {
                const id = () => String(question.id ?? "");
                const options = () => (Array.isArray(question.options) ? (question.options as unknown[]).filter(isRecord) : []);
                return (
                  <div>
                    <p class="text-xs font-medium text-primary">
                      {String(question.label ?? "")}
                      <Show when={question.required}>
                        <span class="text-red-500"> *</span>
                      </Show>
                    </p>
                    <Show when={question.type === "single"}>
                      <div class="mt-1 flex flex-wrap gap-1.5">
                        <For each={options()}>
                          {(option) => (
                            <button
                              type="button"
                              class={`btn-input btn-input-sm ${answers()[id()] === option.value ? "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200" : ""}`}
                              disabled={props.disabled || submitted()}
                              onClick={() => setAnswer(id(), option.value)}
                            >
                              {String(option.label ?? option.value ?? "")}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={question.type === "multiple"}>
                      <div class="mt-1 flex flex-wrap gap-1.5">
                        <For each={options()}>
                          {(option) => (
                            <label class="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-xs text-secondary dark:border-zinc-800">
                              <input
                                type="checkbox"
                                disabled={props.disabled || submitted()}
                                checked={Array.isArray(answers()[id()]) && (answers()[id()] as string[]).includes(String(option.value))}
                                onChange={(event) => toggleAnswer(id(), String(option.value), event.currentTarget.checked)}
                              />
                              {String(option.label ?? option.value ?? "")}
                            </label>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={question.type === "text"}>
                      <input
                        class="input mt-1 h-9 w-full text-sm"
                        disabled={props.disabled || submitted()}
                        placeholder={typeof question.placeholder === "string" ? question.placeholder : ""}
                        value={String(answers()[id()] ?? "")}
                        onInput={(event) => setAnswer(id(), event.currentTarget.value)}
                      />
                    </Show>
                    <Show when={question.type === "rating"}>
                      <input
                        class="mt-2 w-full accent-cyan-500"
                        type="range"
                        disabled={props.disabled || submitted()}
                        min={typeof question.min === "number" ? question.min : 1}
                        max={typeof question.max === "number" ? question.max : 5}
                        value={Number(answers()[id()] ?? question.min ?? 1)}
                        onInput={(event) => setAnswer(id(), Number(event.currentTarget.value))}
                      />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>

          <Show when={error()}>
            <p class="mt-2 text-xs text-red-600 dark:text-red-300">{error()}</p>
          </Show>
          <Show
            when={!props.disabled && !submitted()}
            fallback={<p class="mt-3 text-xs text-dimmed">{submitted() ? "Submitted" : "Waiting for the assistant to continue."}</p>}
          >
            <button type="button" class="btn-ai btn-sm mt-3" onClick={() => void submit()}>
              {String(survey()?.submitLabel ?? "Submit")}
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}

function GenericToolBlock(props: { name: string; args?: unknown; result?: unknown; status?: string }) {
  return (
    <details class="my-1 max-w-xl text-xs text-secondary">
      <summary class="inline-flex cursor-pointer list-none rounded-md px-1.5 py-1 font-medium text-primary hover:bg-zinc-100 dark:hover:bg-zinc-900">
        <span class="inline-flex items-center gap-1.5">
          <i class="ti ti-tool text-sm" aria-hidden="true" />
          {props.name}
          <span class="text-dimmed">{props.status ?? "tool"}</span>
        </span>
      </summary>
      <pre class="mt-1 max-h-52 overflow-auto rounded-md bg-zinc-100 p-2 text-[11px] text-primary dark:bg-zinc-950/70">
        {jsonPreview({ args: props.args, result: props.result })}
      </pre>
    </details>
  );
}

function ToolCallBlockView(props: { block: ToolCallUiBlock | Extract<AssistantMessage["content"][number], { type: "tool_call" }> }) {
  const name = () => props.block.name;
  const args = () => props.block.args;
  return (
    <Show
      when={name() === "cloud_card"}
      fallback={
        <Show
          when={name() === "cloud_survey"}
          fallback={
            <GenericToolBlock
              name={name()}
              args={args()}
              result={"result" in props.block ? props.block.result : undefined}
              status={"status" in props.block ? props.block.status : undefined}
            />
          }
        >
          <CloudSurveyBlock args={args()} disabled />
        </Show>
      }
    >
      <CloudCardBlock args={args()} />
    </Show>
  );
}

function ApprovalBlockView(props: {
  block: ApprovalUiBlock;
  onApproval?: (request: ApprovalUiBlock["request"], input: { approved: boolean; remember?: "always" }) => void | Promise<void>;
}) {
  const pending = () => props.block.status === "pending";
  return (
    <div class="my-2 max-w-xl rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-100">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <p class="font-semibold">Approve tool: {props.block.request.name}</p>
          <p class="mt-0.5 text-xs opacity-80">{props.block.request.message ?? "The assistant wants to run this tool."}</p>
        </div>
        <Show when={pending()} fallback={<span class="text-xs font-medium opacity-80">{props.block.status}</span>}>
          <div class="flex shrink-0 flex-wrap gap-1">
            <button
              type="button"
              class="btn-input btn-input-sm"
              onClick={() => void props.onApproval?.(props.block.request, { approved: false })}
            >
              Reject
            </button>
            <button type="button" class="btn-ai btn-sm" onClick={() => void props.onApproval?.(props.block.request, { approved: true })}>
              Approve
            </button>
            <Show when={props.block.request.allowAlways}>
              <button
                type="button"
                class="btn-input btn-input-sm"
                onClick={() => void props.onApproval?.(props.block.request, { approved: true, remember: "always" })}
              >
                Always allow
              </button>
            </Show>
          </div>
        </Show>
      </div>
      <details class="mt-2 text-xs">
        <summary class="cursor-pointer opacity-75">Details</summary>
        <pre class="mt-1 max-h-40 overflow-auto rounded-md bg-white/55 p-2 text-[11px] text-primary dark:bg-black/20">
          {jsonPreview(props.block.request.args)}
        </pre>
      </details>
    </div>
  );
}

function FrontendToolBlockView(props: {
  block: FrontendToolUiBlock;
  onResult?: (request: FrontendToolUiBlock["request"], result: unknown) => void | Promise<void>;
}) {
  const request = () => props.block.request;
  const pending = () => props.block.status === "pending";
  return (
    <Show
      when={request().name === "cloud_card"}
      fallback={
        <Show
          when={request().name === "cloud_survey"}
          fallback={
            <GenericToolBlock name={request().name} args={request().args} result={props.block.result} status={props.block.status} />
          }
        >
          <CloudSurveyBlock args={request().args} disabled={!pending()} onSubmit={(result) => props.onResult?.(request(), result)} />
        </Show>
      }
    >
      <CloudCardBlock args={request().args} />
    </Show>
  );
}

function ActiveAssistantBlock(props: {
  block: AiUiBlock;
  onApproval?: (request: ApprovalUiBlock["request"], input: { approved: boolean; remember?: "always" }) => void | Promise<void>;
  onFrontendToolResult?: (request: FrontendToolUiBlock["request"], result: unknown) => void | Promise<void>;
}) {
  const block = props.block;
  switch (block.type) {
    case "text":
      return <MarkdownView html={markdown.renderSync(block.text)} class="markdown-content-sm" />;
    case "thinking":
      return <AssistantThinkingBlock text={block.text} streaming />;
    case "tool_call":
      return <ToolCallBlockView block={block} />;
    case "approval_request":
      return <ApprovalBlockView block={block} onApproval={props.onApproval} />;
    case "frontend_tool":
      return <FrontendToolBlockView block={block} onResult={props.onFrontendToolResult} />;
    case "compaction":
      return (
        <p class="my-2 inline-flex items-center gap-1.5 rounded-md bg-cyan-50 px-2 py-1 text-xs text-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-200">
          <i class="ti ti-package text-sm" aria-hidden="true" />
          {block.status === "running" ? "Compacting context" : "Context compacted"}
        </p>
      );
    case "error":
      return (
        <p class="my-2 inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/35 dark:text-red-300">
          <i class="ti ti-alert-circle text-sm" aria-hidden="true" />
          {block.message}
        </p>
      );
  }
}

function AssistantMessageBlock(props: { message: Message; streaming?: boolean }) {
  const blocks = () => assistantVisibleBlocks(props.message);

  return (
    <div class="px-3 py-2">
      <div class="max-w-[min(46rem,100%)] text-sm leading-6 text-primary">
        <Show
          when={blocks().length > 0}
          fallback={
            <p class="inline-flex items-center gap-1.5 text-xs text-dimmed">
              <i class="ti ti-sparkles text-sm" aria-hidden="true" />
              {props.streaming ? "Thinking..." : "No text content"}
            </p>
          }
        >
          <For each={blocks()}>
            {(block) => (
              <Show
                when={block.type === "thinking"}
                fallback={
                  <Show
                    when={block.type === "text"}
                    fallback={
                      <Show when={block.type === "tool_call"}>
                        <ToolCallBlockView block={block as Extract<AssistantMessage["content"][number], { type: "tool_call" }>} />
                      </Show>
                    }
                  >
                    <MarkdownView html={markdown.renderSync(block.type === "text" ? block.text : "")} class="markdown-content-sm" />
                  </Show>
                }
              >
                <AssistantThinkingBlock text={block.type === "thinking" ? block.thinking : ""} streaming={props.streaming} />
              </Show>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function SystemMessageBlock(props: { entry: AiStoredMessage }) {
  const text = () => textFromMessage(props.entry.message);
  const title = () => (props.entry.kind === "summary" ? "Summary" : props.entry.message.role === "tool_result" ? "Tool result" : "System");

  return (
    <div class="px-3 py-1.5">
      <div class="inline-flex max-w-[min(46rem,100%)] items-start gap-2 rounded-md bg-zinc-100/70 px-2.5 py-1.5 text-xs text-secondary dark:bg-zinc-900/70">
        <i class="ti ti-info-circle mt-0.5 text-sm text-dimmed" aria-hidden="true" />
        <div class="min-w-0">
          <p class="font-medium text-primary">{title()}</p>
          <Show when={text()} fallback={<p class="text-dimmed">No visible content</p>}>
            <p class="mt-0.5 whitespace-pre-wrap">{text()}</p>
          </Show>
        </div>
      </div>
    </div>
  );
}

export function AiMessageList(props: {
  messages: () => AiStoredMessage[];
  assistantDraft?: () => string;
  assistantThinkingDraft?: () => string;
  assistantBlocks?: () => AiUiBlock[];
  onApproval?: (request: ApprovalUiBlock["request"], input: { approved: boolean; remember?: "always" }) => void | Promise<void>;
  onFrontendToolResult?: (request: FrontendToolUiBlock["request"], result: unknown) => void | Promise<void>;
  streaming?: () => boolean;
  emptyTitle?: string;
}) {
  let endRef: HTMLDivElement | undefined;

  createEffect(() => {
    props.messages().length;
    props.assistantDraft?.();
    props.assistantThinkingDraft?.();
    props.assistantBlocks?.();
    props.streaming?.();
    queueMicrotask(() => endRef?.scrollIntoView({ block: "end" }));
  });

  const assistantDraftMessage = (): AssistantMessage => ({
    role: "assistant",
    content: [
      ...(props.assistantThinkingDraft?.() ? [{ type: "thinking" as const, thinking: props.assistantThinkingDraft!() }] : []),
      ...(props.assistantDraft?.() ? [{ type: "text" as const, text: props.assistantDraft!() }] : []),
    ],
  });
  const activeBlocks = () => props.assistantBlocks?.() ?? [];
  const hasAssistantDraft = () => activeBlocks().length > 0 || assistantDraftMessage().content.length > 0;
  const showStreamingPlaceholder = () => Boolean(props.streaming?.() && !hasAssistantDraft());

  return (
    <div class="min-h-full px-2 py-4 sm:px-4">
      <Show
        when={props.messages().length > 0 || hasAssistantDraft() || props.streaming?.()}
        fallback={
          <div class="flex min-h-full items-center justify-center p-4">
            <Placeholder surface="none" icon="ti ti-sparkles">
              {props.emptyTitle ?? "Start a conversation"}
            </Placeholder>
          </div>
        }
      >
        <div class="mx-auto flex max-w-4xl flex-col gap-1">
          <For each={props.messages()}>
            {(entry) => (
              <Show
                when={entry.kind === "message" && entry.message.role === "user"}
                fallback={
                  <Show
                    when={entry.kind === "message" && entry.message.role === "assistant"}
                    fallback={<SystemMessageBlock entry={entry} />}
                  >
                    <AssistantMessageBlock message={entry.message} />
                  </Show>
                }
              >
                <UserMessageBubble message={entry.message} />
              </Show>
            )}
          </For>
          <Show when={activeBlocks().length > 0}>
            <div class="px-3 py-2">
              <div class="max-w-[min(46rem,100%)] text-sm leading-6 text-primary">
                <For each={activeBlocks()}>
                  {(block) => (
                    <ActiveAssistantBlock block={block} onApproval={props.onApproval} onFrontendToolResult={props.onFrontendToolResult} />
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={activeBlocks().length === 0 && assistantDraftMessage().content.length > 0}>
            <AssistantMessageBlock message={assistantDraftMessage()} streaming />
          </Show>
          <Show when={showStreamingPlaceholder()}>
            <AssistantMessageBlock message={{ role: "assistant", content: [] }} streaming />
          </Show>
          <div ref={endRef} />
        </div>
      </Show>
    </div>
  );
}

export function AiComposer(props: {
  models: () => AiPublicModelProfile[];
  selectedModelId: () => string;
  onModelChange: (id: string) => void;
  onNewConversation?: () => void | Promise<void>;
  disabled: () => boolean;
  running: () => boolean;
  placeholder?: string;
  usage?: () => Usage | null;
  slashCommands?: () => AiSlashCommand[];
  onSend: (input: AiComposerSendInput) => boolean | Promise<boolean>;
  onStop: () => void;
}) {
  const [draft, setDraft] = createSignal("");
  const [pendingAttachments, setPendingAttachments] = createSignal<PendingAiAttachment[]>([]);
  const [selectedCommandIndex, setSelectedCommandIndex] = createSignal(0);
  const [dragActive, setDragActive] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  const selectedModel = createMemo(() => props.models().find((model) => model.id === props.selectedModelId()) ?? null);
  const supportsVision = () => Boolean(selectedModel()?.capabilities.includes("vision"));
  const canSubmit = () => !props.disabled() && (draft().trim().length > 0 || pendingAttachments().length > 0);
  const slashCommands = () => props.slashCommands?.() ?? [];
  const modelPickerDisabled = () => props.disabled() || props.running() || props.models().length === 0;
  const slashMatches = createMemo(() => {
    const value = draft();
    if (!value.startsWith("/") || /\s/.test(value)) return [];
    const query = value.slice(1).toLowerCase();
    return slashCommands().filter((command) => command.name.toLowerCase().startsWith(query));
  });

  const autoResize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 132)}px`;
  };

  createEffect(() => {
    slashMatches();
    setSelectedCommandIndex(0);
  });

  createEffect(() => {
    if (supportsVision()) return;
    setPendingAttachments((current) => {
      const next = current.filter((attachment) => attachment.kind !== "image");
      if (next.length !== current.length) {
        toast.error("Image attachments were removed because the selected model does not support vision.", {
          title: "Vision unavailable",
        });
      }
      return next;
    });
  });

  const focus = () => textareaRef?.focus();

  const modelDropdownItems = (): DropdownItem[] =>
    props.models().map((model) => ({
      element: (close: () => void) => (
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-secondary transition-colors hover:bg-zinc-100 dark:hover:bg-white/10"
          onClick={() => {
            props.onModelChange(model.id);
            close();
            requestAnimationFrame(focus);
          }}
        >
          <i
            class={`${model.capabilities.includes("vision") ? "ti ti-photo-spark" : "ti ti-message"} text-base text-dimmed`}
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-primary">{model.label}</span>
            <span class="block truncate text-xs text-dimmed">{model.model}</span>
          </span>
          <Show when={model.id === props.selectedModelId()}>
            <i class="ti ti-check text-sm text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
          </Show>
        </button>
      ),
    }));

  const actionDropdownItems = (): DropdownItem[] => [
    ...(props.onNewConversation
      ? [
          {
            icon: "ti ti-message-plus",
            label: "New chat",
            action: () => {
              void props.onNewConversation?.();
            },
          } satisfies DropdownItem,
        ]
      : []),
    {
      icon: "ti ti-paperclip",
      label: "Upload files",
      action: () => fileInputRef?.click(),
    },
  ];

  const readAttachment = async (file: File): Promise<PendingAiAttachment | null> => {
    if (file.type.startsWith("image/")) {
      if (!supportsVision()) {
        toast.error("Choose a vision-capable model before attaching images.", { title: "Vision unavailable" });
        return null;
      }
      return readImageFile(file);
    }
    if (isTextAttachmentFile(file)) return readTextFile(file);
    toast.error(`${file.name} is not a supported attachment type.`, { title: "Unsupported file" });
    return null;
  };

  const addAttachments = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;

    const remainingSlots = MAX_ATTACHMENTS - pendingAttachments().length;
    if (remainingSlots <= 0) {
      toast.error(`Remove an attachment before adding more. Assistant supports up to ${MAX_ATTACHMENTS} files.`, {
        title: "Attachment limit reached",
      });
      return;
    }

    const candidates = selected.slice(0, remainingSlots);
    const discarded = selected.length - candidates.length;
    if (discarded > 0) {
      toast.error(`${discarded} attachment${discarded === 1 ? "" : "s"} discarded. Assistant supports up to ${MAX_ATTACHMENTS} files.`, {
        title: "Attachment limit reached",
      });
    }

    const next: PendingAiAttachment[] = [];
    for (const file of candidates) {
      try {
        const attachment = await readAttachment(file);
        if (attachment) next.push(attachment);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not attach ${file.name}.`, { title: "Attachment failed" });
      }
    }
    if (next.length) setPendingAttachments((current) => [...current, ...next]);
  };

  const removeAttachment = (id: string) => setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));

  const submit = async () => {
    if (props.running()) {
      props.onStop();
      return;
    }
    if (!canSubmit()) return;

    const text = draft().trim();
    const attachments = pendingAttachments();
    const textAttachments = attachments.filter((attachment): attachment is PendingAiTextFile => attachment.kind === "text");
    const imageAttachments = attachments.filter((attachment): attachment is PendingAiImage => attachment.kind === "image");
    const attachmentContext = textAttachmentContext(textAttachments);
    const content =
      attachments.length > 0
        ? ([
            ...(text ? [{ type: "text" as const, text }] : []),
            ...(attachmentContext ? [{ type: "text" as const, text: attachmentContext }] : []),
            ...imageAttachments.map((image) => ({ type: "file" as const, data: image.data, mediaType: image.mediaType })),
          ] satisfies AiUserContentPart[])
        : undefined;

    const previousDraft = draft();
    setDraft("");
    setPendingAttachments([]);
    requestAnimationFrame(() => {
      autoResize();
      focus();
    });

    const sent = await Promise.resolve(props.onSend({ message: text || undefined, content })).catch(() => false);
    if (!sent) {
      setDraft(previousDraft);
      setPendingAttachments(attachments);
      requestAnimationFrame(() => {
        autoResize();
        focus();
      });
    }
  };

  const executeCommand = async (command: AiSlashCommand) => {
    setDraft("");
    await command.action({ setDraft, submit: () => void submit(), focus });
    requestAnimationFrame(() => {
      autoResize();
      focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const matches = slashMatches();
    if (matches.length > 0) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedCommandIndex((index) => (index > 0 ? index - 1 : matches.length - 1));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedCommandIndex((index) => (index < matches.length - 1 ? index + 1 : 0));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const command = matches[selectedCommandIndex()];
        if (command) void executeCommand(command);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDraft("");
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    const files = event.dataTransfer?.files;
    if (files?.length) void addAttachments(files);
  };

  return (
    <div class="pointer-events-auto mx-auto w-full max-w-4xl">
      <Show when={slashMatches().length > 0}>
        <div class="mb-2 overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 shadow-[var(--theme-shadow-float)] dark:border-zinc-800 dark:bg-zinc-900">
          <For each={slashMatches()}>
            {(command, index) => (
              <button
                type="button"
                class={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  index() === selectedCommandIndex()
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/45 dark:text-blue-200"
                    : "text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  void executeCommand(command);
                }}
              >
                <i class={`${command.icon ?? "ti ti-slash"} text-base`} aria-hidden="true" />
                <span class="font-medium">/{command.name}</span>
                <span class="truncate text-xs text-dimmed">{command.description}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div
        role="group"
        aria-label="Assistant message composer"
        class={`relative overflow-hidden rounded-lg border bg-white text-primary shadow-[var(--theme-shadow-elevated)] transition-[background-color,border-color,box-shadow] dark:bg-zinc-900 ${
          dragActive()
            ? "border-cyan-400 bg-teal-50 dark:border-cyan-500 dark:bg-teal-950/30"
            : "border-cyan-300/80 dark:border-cyan-800/80"
        }`}
        onDragEnter={(event) => {
          if (!event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        <Show when={dragActive()}>
          <div class="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-teal-50/85 text-sm font-medium text-cyan-700 dark:bg-teal-950/80 dark:text-cyan-200">
            Drop files to attach
          </div>
        </Show>

        <Show when={pendingAttachments().length > 0}>
          <div class="flex flex-wrap gap-2 px-3 pt-3">
            <For each={pendingAttachments()}>
              {(attachment) => (
                <div class="group relative h-14 w-14">
                  <Show
                    when={attachment.kind === "image"}
                    fallback={
                      <div
                        class="grid h-14 w-14 place-items-center rounded-md border border-zinc-200 bg-zinc-100 px-1 text-center dark:border-zinc-800 dark:bg-zinc-900"
                        title={`${attachment.name}, ${formatBytes(attachment.size)}`}
                      >
                        <div class="min-w-0">
                          <i class={`ti ${(attachment as PendingAiTextFile).icon} text-lg`} aria-hidden="true" />
                          <p class="mt-0.5 w-12 truncate text-[10px] leading-3 text-dimmed">{attachment.name}</p>
                        </div>
                      </div>
                    }
                  >
                    <img
                      src={imageSrc(attachment as PendingAiImage)}
                      alt={attachment.name}
                      class="h-14 w-14 rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
                    />
                  </Show>
                  <button
                    type="button"
                    class="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-zinc-950 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 dark:bg-white dark:text-zinc-950"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <i class="ti ti-x text-[10px]" aria-hidden="true" />
                  </button>
                  <span class="sr-only">
                    {attachment.name}, {formatBytes(attachment.size)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <textarea
          ref={textareaRef}
          class="block min-h-14 max-h-36 w-full resize-none bg-transparent px-3 pt-3 text-base leading-6 text-primary outline-none placeholder:text-dimmed disabled:cursor-not-allowed disabled:opacity-60 md:text-sm"
          rows={1}
          value={draft()}
          disabled={props.disabled()}
          placeholder={props.placeholder ?? "Ask Assistant anything or type / ..."}
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            autoResize();
          }}
          onKeyDown={onKeyDown}
        />

        <div class="flex min-h-10 items-center gap-1 px-2 pb-2 pt-1">
          <Show when={props.models().length > 0}>
            <Show
              when={!modelPickerDisabled()}
              fallback={
                <span class="inline-flex h-8 max-w-52 items-center gap-1.5 px-1.5 text-xs text-dimmed">
                  <i class="ti ti-sparkles text-sm" aria-hidden="true" />
                  <span class="truncate">{selectedModel()?.label ?? "Model"}</span>
                </span>
              }
            >
              <Dropdown
                position="top-right"
                width="w-72"
                elements={modelDropdownItems()}
                trigger={
                  <span class="inline-flex h-8 max-w-52 items-center gap-1.5 rounded-md px-1.5 text-xs text-secondary transition-colors hover:text-cyan-700 dark:hover:text-cyan-300">
                    <i class="ti ti-sparkles text-sm" aria-hidden="true" />
                    <span class="truncate">{selectedModel()?.label ?? "Model"}</span>
                    <i class="ti ti-chevron-down text-[10px] text-dimmed" aria-hidden="true" />
                  </span>
                }
              />
            </Show>
          </Show>

          <Show
            when={!props.disabled()}
            fallback={
              <span class="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-300 dark:text-zinc-700">
                <i class="ti ti-plus text-base" aria-hidden="true" />
              </span>
            }
          >
            <Dropdown
              position="top-right"
              elements={actionDropdownItems()}
              trigger={
                <span
                  class="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-gradient-to-br hover:from-teal-500 hover:to-blue-500 hover:bg-clip-text hover:text-transparent dark:text-zinc-500"
                  title="Assistant actions"
                >
                  <i class="ti ti-plus text-base" aria-hidden="true" />
                </span>
              }
            />
          </Show>
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_INPUT_ACCEPT}
            multiple
            class="hidden"
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files?.length) void addAttachments(files);
              event.currentTarget.value = "";
            }}
          />

          <div class="flex-1" />

          <AiContextIndicator usage={props.usage?.()} contextWindow={selectedModel()?.contextWindow} />

          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:text-cyan-600 focus-ui disabled:cursor-not-allowed disabled:opacity-35 dark:text-zinc-500 dark:hover:text-cyan-300"
            disabled={props.running() ? false : !canSubmit()}
            title={props.running() ? "Stop" : "Send"}
            aria-label={props.running() ? "Stop" : "Send"}
            onClick={() => void submit()}
          >
            <i class={`ti ${props.running() ? "ti-player-stop" : "ti-arrow-up"} text-base`} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

export const aiLatestUsage = latestUsage;
export const aiMessageText = textFromMessage;
