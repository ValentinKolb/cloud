import type { Usage } from "@valentinkolb/nessi";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Dropdown, type DropdownItem, ProgressBar, toast } from "../../ui";
import type { AiPublicModelProfile, AiUserContentPart } from "../types";
import {
  type AiComposerAttachment,
  formatBytes,
  formatTokens,
  imageSrc,
  MAX_ATTACHMENTS,
  type PendingAiAttachment,
  type PendingAiImage,
  type PendingAiVfsFile,
  readImageFile,
  readVfsFile,
} from "./message-utils";

export type { AiComposerAttachment } from "./message-utils";

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
  /** Non-image attachments — uploaded into the conversation VFS by the controller before the turn starts. */
  files?: File[];
};

export function AiContextIndicator(props: { usage?: Usage | null; loopUsage?: Usage | null; contextWindow?: number }) {
  const total = () => props.usage?.total ?? 0;
  const windowSize = () => props.contextWindow;
  const percent = () => {
    const contextWindow = windowSize();
    if (!contextWindow || total() <= 0) return null;
    return Math.min(100, Math.round((total() / contextWindow) * 100));
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
        <p class="font-medium text-primary">Last request context</p>
        <Show when={percent() !== null}>
          <div class="mt-2">
            <ProgressBar value={percent()!} size="xs" tone={(percent() ?? 0) >= 85 ? "danger" : "primary"} />
          </div>
        </Show>
        <div class="mt-2 space-y-1">
          <p class="flex justify-between gap-3">
            <span>Input</span>
            <span class="tabular-nums text-primary">{props.usage?.input?.toLocaleString() ?? "Unknown"}</span>
          </p>
          <p class="flex justify-between gap-3">
            <span>Output</span>
            <span class="tabular-nums text-primary">{props.usage?.output?.toLocaleString() ?? "Unknown"}</span>
          </p>
          <p class="flex justify-between gap-3">
            <span>Request total</span>
            <span class="tabular-nums text-primary">{total() > 0 ? total().toLocaleString() : "Unknown"}</span>
          </p>
          <Show when={(props.loopUsage?.total ?? 0) > 0}>
            <p class="flex justify-between gap-3">
              <span>Loop total</span>
              <span class="tabular-nums text-primary">{props.loopUsage!.total.toLocaleString()}</span>
            </p>
          </Show>
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
      </div>
    </div>
  );
}

function AiSlashCommandMenu(props: { commands: AiSlashCommand[]; selectedIndex: number; onSelect: (command: AiSlashCommand) => void }) {
  return (
    <div class="mb-2 flex flex-col gap-0.5 overflow-hidden rounded-xl bg-white/95 p-1.5 ring-1 ring-inset ring-zinc-300/60 backdrop-blur dark:bg-zinc-950/95 dark:ring-zinc-700/60">
      <For each={props.commands}>
        {(command, index) => (
          <button
            type="button"
            class={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
              index() === props.selectedIndex
                ? "bg-blue-50/80 text-blue-900 dark:bg-blue-950/45 dark:text-blue-100"
                : "text-secondary hover:bg-zinc-200/65 dark:hover:bg-zinc-800/70"
            }`}
            onMouseDown={(event) => {
              event.preventDefault();
              props.onSelect(command);
            }}
          >
            <i class={`${command.icon ?? "ti ti-slash"} text-sm text-dimmed`} aria-hidden="true" />
            <span class="font-medium">/{command.name}</span>
            <span class="truncate text-xs text-dimmed">{command.description}</span>
          </button>
        )}
      </For>
    </div>
  );
}

function AiAttachmentPreviewList(props: { attachments: PendingAiAttachment[]; onRemove: (id: string) => void }) {
  return (
    <div class="flex flex-wrap gap-2 px-3 pt-3">
      <For each={props.attachments}>
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
                    <i class={`ti ${attachment.kind === "image" ? "ti-photo" : attachment.icon} text-lg`} aria-hidden="true" />
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
              onClick={() => props.onRemove(attachment.id)}
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
  );
}

export type AiComposerModels = {
  profiles: () => AiPublicModelProfile[];
  selectedId: () => string;
  onSelect: (id: string) => void;
};

export type AiComposerState = {
  draft?: () => string;
  onDraftChange?: (value: string) => void;
  attachments?: () => AiComposerAttachment[];
  onAttachmentsChange?: (attachments: AiComposerAttachment[]) => void;
  disabled: () => boolean;
  running: () => boolean;
  focusToken?: () => unknown;
  placeholder?: string;
  usage?: () => Usage | null;
  loopUsage?: () => Usage | null;
  /** Conversation VFS indicator: shows a files chip when count > 0; click opens the browser. */
  files?: { count: () => number; onOpen: () => void };
};

export type AiComposerActions = {
  slashCommands?: () => AiSlashCommand[];
  onNewConversation?: () => void | Promise<void>;
  send: (input: AiComposerSendInput) => boolean | Promise<boolean>;
  stop: () => void;
};

export function AiComposer(props: { models: AiComposerModels; state: AiComposerState; actions: AiComposerActions }) {
  const [uncontrolledDraft, setUncontrolledDraft] = createSignal("");
  const [uncontrolledAttachments, setUncontrolledAttachments] = createSignal<PendingAiAttachment[]>([]);
  const [selectedCommandIndex, setSelectedCommandIndex] = createSignal(0);
  const [dragActive, setDragActive] = createSignal(false);
  let composerRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let sawRunning = props.state.running();

  const draft = () => props.state.draft?.() ?? uncontrolledDraft();
  const setDraftValue = (value: string) => {
    if (props.state.onDraftChange) props.state.onDraftChange(value);
    else setUncontrolledDraft(value);
  };
  const pendingAttachments = () => props.state.attachments?.() ?? uncontrolledAttachments();
  const setAttachments = (next: PendingAiAttachment[] | ((current: PendingAiAttachment[]) => PendingAiAttachment[])) => {
    const value = typeof next === "function" ? next(pendingAttachments()) : next;
    if (props.state.onAttachmentsChange) props.state.onAttachmentsChange(value);
    else setUncontrolledAttachments(value);
  };

  const selectedModel = createMemo(() => props.models.profiles().find((model) => model.id === props.models.selectedId()) ?? null);
  const supportsVision = () => Boolean(selectedModel()?.capabilities.includes("vision"));
  const canSubmit = () => !props.state.disabled() && (draft().trim().length > 0 || pendingAttachments().length > 0);
  const slashCommands = () => props.actions.slashCommands?.() ?? [];
  const modelPickerDisabled = () => props.state.disabled() || props.state.running() || props.models.profiles().length === 0;
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
    setAttachments((current) => {
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

  createEffect(() => {
    if (!props.state.focusToken) return;
    props.state.focusToken();
    requestAnimationFrame(focus);
  });

  const shouldRestoreComposerFocus = () => {
    if (typeof document === "undefined") return false;
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return true;
    if (composerRef?.contains(active)) return true;
    if (active.closest("[role='dialog'],[popover]")) return false;
    const tag = active.tagName.toLowerCase();
    return tag !== "input" && tag !== "textarea" && tag !== "select" && !active.isContentEditable;
  };

  createEffect(() => {
    const isRunning = props.state.running();
    if (sawRunning && !isRunning && !props.state.disabled()) {
      requestAnimationFrame(() => {
        if (shouldRestoreComposerFocus()) focus();
      });
    }
    sawRunning = isRunning;
  });

  const modelDropdownItems = (): DropdownItem[] =>
    props.models.profiles().map((model) => ({
      element: (close: () => void) => (
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-secondary transition-colors hover:bg-zinc-100 dark:hover:bg-white/10"
          onClick={() => {
            props.models.onSelect(model.id);
            close();
            requestAnimationFrame(focus);
          }}
        >
          <Show
            when={model.image}
            fallback={
              <i
                class={`${model.capabilities.includes("vision") ? "ti ti-photo-spark" : "ti ti-message"} text-base text-dimmed`}
                aria-hidden="true"
              />
            }
          >
            <img src={model.image} alt="" class="h-5 w-5 shrink-0 rounded" aria-hidden="true" />
          </Show>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-primary">{model.label}</span>
            <span class="block truncate text-xs text-dimmed">{model.model}</span>
          </span>
          <Show when={model.id === props.models.selectedId()}>
            <i class="ti ti-check text-sm text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
          </Show>
        </button>
      ),
    }));

  const actionDropdownItems = (): DropdownItem[] => [
    ...(props.actions.onNewConversation
      ? [
          {
            icon: "ti ti-message-plus",
            label: "New chat",
            action: () => {
              void props.actions.onNewConversation?.();
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
    // Everything else goes into the conversation filesystem on send.
    return readVfsFile(file);
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
    if (next.length) setAttachments((current) => [...current, ...next]);
  };

  const removeAttachment = (id: string) => setAttachments((current) => current.filter((attachment) => attachment.id !== id));

  const submit = async () => {
    if (props.state.running()) {
      props.actions.stop();
      return;
    }
    if (!canSubmit()) return;

    const text = draft().trim();
    const attachments = pendingAttachments();
    const imageAttachments = attachments.filter((attachment): attachment is PendingAiImage => attachment.kind === "image");
    const vfsFiles = attachments.filter((attachment): attachment is PendingAiVfsFile => attachment.kind === "file");
    const content =
      attachments.length > 0
        ? ([
            ...(text ? [{ type: "text" as const, text }] : []),
            ...imageAttachments.map((image) => ({ type: "file" as const, data: image.data, mediaType: image.mediaType })),
          ] satisfies AiUserContentPart[])
        : undefined;

    const previousDraft = draft();
    setDraftValue("");
    setAttachments([]);
    requestAnimationFrame(() => {
      autoResize();
      focus();
    });

    const sent = await Promise.resolve(
      props.actions.send({
        message: text || undefined,
        content: content?.length ? content : undefined,
        files: vfsFiles.length ? vfsFiles.map((pending) => pending.file) : undefined,
      }),
    ).catch(() => false);
    if (!sent) {
      setDraftValue(previousDraft);
      setAttachments(attachments);
      requestAnimationFrame(() => {
        autoResize();
        focus();
      });
    }
  };

  const executeCommand = async (command: AiSlashCommand) => {
    setDraftValue("");
    await command.action({ setDraft: setDraftValue, submit: () => void submit(), focus });
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
        setDraftValue("");
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
    <div ref={composerRef} class="pointer-events-auto mx-auto w-full max-w-4xl">
      <Show when={slashMatches().length > 0}>
        <AiSlashCommandMenu
          commands={slashMatches()}
          selectedIndex={selectedCommandIndex()}
          onSelect={(command) => void executeCommand(command)}
        />
      </Show>

      <div
        role="group"
        aria-label="Assistant message composer"
        class={`relative overflow-visible rounded-lg border bg-white text-primary shadow-[var(--theme-shadow-elevated)] transition-[background-color,border-color,box-shadow] dark:bg-zinc-900 ${
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
          <div class="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-teal-50/85 text-sm font-medium text-cyan-700 dark:bg-teal-950/80 dark:text-cyan-200">
            Drop files to attach
          </div>
        </Show>

        <Show when={pendingAttachments().length > 0}>
          <AiAttachmentPreviewList attachments={pendingAttachments()} onRemove={removeAttachment} />
        </Show>

        <textarea
          ref={textareaRef}
          class="block min-h-14 max-h-36 w-full resize-none bg-transparent px-3 pt-3 text-base leading-6 text-primary outline-none placeholder:text-dimmed disabled:cursor-not-allowed disabled:opacity-60 md:text-sm"
          rows={1}
          value={draft()}
          disabled={props.state.disabled()}
          placeholder={props.state.placeholder ?? "Ask Assistant anything or type / ..."}
          onInput={(event) => {
            setDraftValue(event.currentTarget.value);
            autoResize();
          }}
          onKeyDown={onKeyDown}
        />

        <div class="flex min-h-10 items-center gap-1 px-2 pb-2 pt-1">
          <Show when={props.models.profiles().length > 0}>
            <Show
              when={!modelPickerDisabled()}
              fallback={
                <span class="inline-flex h-8 max-w-52 items-center gap-1.5 px-1.5 text-xs text-dimmed">
                  <Show when={selectedModel()?.image} fallback={<i class="ti ti-sparkles text-sm" aria-hidden="true" />}>
                    <img src={selectedModel()?.image} alt="" class="h-4 w-4 shrink-0 rounded" aria-hidden="true" />
                  </Show>
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
                    <Show when={selectedModel()?.image} fallback={<i class="ti ti-sparkles text-sm" aria-hidden="true" />}>
                      <img src={selectedModel()?.image} alt="" class="h-4 w-4 shrink-0 rounded" aria-hidden="true" />
                    </Show>
                    <span class="truncate">{selectedModel()?.label ?? "Model"}</span>
                    <i class="ti ti-chevron-down text-[10px] text-dimmed" aria-hidden="true" />
                  </span>
                }
              />
            </Show>
          </Show>

          <Show
            when={!props.state.disabled()}
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
            multiple
            class="hidden"
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files?.length) void addAttachments(files);
              event.currentTarget.value = "";
            }}
          />

          <div class="flex-1" />

          <Show when={props.state.files && (props.state.files.count() ?? 0) > 0}>
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs tabular-nums text-dimmed outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-cyan-300 dark:hover:bg-zinc-800"
              title="Files in this chat"
              onClick={() => props.state.files?.onOpen()}
            >
              <i class="ti ti-paperclip text-sm" aria-hidden="true" />
              <span>{props.state.files!.count()}</span>
            </button>
          </Show>

          <AiContextIndicator
            usage={props.state.usage?.()}
            loopUsage={props.state.loopUsage?.()}
            contextWindow={selectedModel()?.contextWindow}
          />

          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:text-cyan-600 focus-ui disabled:cursor-not-allowed disabled:opacity-35 dark:text-zinc-500 dark:hover:text-cyan-300"
            disabled={props.state.running() ? false : !canSubmit()}
            title={props.state.running() ? "Stop" : "Send"}
            aria-label={props.state.running() ? "Stop" : "Send"}
            onClick={() => void submit()}
          >
            <i class={`ti ${props.state.running() ? "ti-player-stop" : "ti-arrow-up"} text-base`} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
