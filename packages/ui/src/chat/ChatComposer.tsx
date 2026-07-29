import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onMount,
  Show,
} from "solid-js";
import { Select, type SelectOption } from "../inputs/Select";
import {
  filterChatCommands,
  nextChatCommandIndex,
  reportChatFailure,
  runChatSubmission,
} from "./chat-behavior";

export type ChatModelOption = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  capabilities?: readonly string[];
};

export type ChatAttachment = {
  id: string;
  name: string;
  size?: number;
  kind?: "file" | "image";
  icon?: string;
  previewUrl?: string;
  /** Opaque application-owned payload returned unchanged with ChatSendInput. */
  data?: unknown;
};

export type ChatSendInput = {
  text: string;
  attachments: readonly ChatAttachment[];
};

export type ChatCommandContext = {
  setValue: (value: string) => void;
  submit: () => void;
  focus: () => void;
};

export type ChatCommand = {
  name: string;
  description: string;
  icon?: string;
  action: (context: ChatCommandContext) => void | Promise<void>;
};

export type ChatFileSelection = {
  onSelect: (files: readonly File[]) => void | Promise<void>;
  onError?: (error: unknown) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
};

export type ChatComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (input: ChatSendInput) => boolean | void | Promise<boolean | void>;
  onSteer?: (text: string) => boolean | void | Promise<boolean | void>;
  onStop?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  attachments?: readonly ChatAttachment[];
  onAttachmentsChange?: (attachments: readonly ChatAttachment[]) => void;
  fileSelection?: ChatFileSelection;
  models?: readonly ChatModelOption[];
  selectedModelId?: string | null;
  onModelChange?: (modelId: string) => void;
  commands?: readonly ChatCommand[];
  context?: JSX.Element;
  actions?: JSX.Element;
  placeholder?: string;
  label?: string;
  inputLabel?: string;
  disabled?: boolean;
  running?: boolean;
  stopping?: boolean;
  error?: JSX.Element;
  focusToken?: unknown;
  class?: string;
};

const attachmentIcon = (attachment: ChatAttachment): string =>
  attachment.icon ??
  (attachment.kind === "image" ? "ti ti-photo" : "ti ti-file");

const formatBytes = (bytes: number | undefined): string | null => {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${Math.round(bytes)} B`;
};

export function ChatComposer(props: ChatComposerProps): JSX.Element {
  const commandListId = `k2b-chat-commands-${createUniqueId().replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const [selectedCommandIndex, setSelectedCommandIndex] = createSignal(0);
  const [dragActive, setDragActive] = createSignal(false);
  const [addingFiles, setAddingFiles] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  let composerRef: HTMLElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let sawRunning = Boolean(props.running);

  const attachments = () => props.attachments ?? [];
  const commands = () => props.commands ?? [];
  const commandMatches = createMemo(() => filterChatCommands(props.value, commands()));
  const commandsOpen = () => commandMatches().length > 0;
  const selectedCommand = () => commandMatches()[selectedCommandIndex()];
  const blocked = () => Boolean(props.disabled || props.stopping || addingFiles() || submitting());
  const canSubmit = () =>
    !blocked() &&
    (props.running
      ? Boolean(props.onSteer && props.value.trim())
      : Boolean(props.value.trim() || attachments().length > 0));
  const canSelectFiles = () =>
    Boolean(props.fileSelection && !props.fileSelection.disabled && !props.running && !blocked());

  const modelOptions = (): SelectOption[] =>
    (props.models ?? []).map((model) => ({
      value: model.id,
      label: model.label,
      description: model.description,
      icon: model.icon,
    }));

  const autoResize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 144)}px`;
  };

  const focus = () => textareaRef?.focus();

  onMount(() => {
    autoResize();
    if (props.focusToken !== undefined) focus();
  });

  createEffect(() => {
    commandMatches();
    setSelectedCommandIndex(0);
  });

  createEffect(() => {
    props.focusToken;
    if (props.focusToken !== undefined) queueMicrotask(focus);
  });

  createEffect(() => {
    const running = Boolean(props.running);
    if (sawRunning && !running && !props.disabled && typeof document !== "undefined") {
      const active = document.activeElement as HTMLElement | null;
      const insideComposer = Boolean(active && composerRef?.contains(active));
      const editingElsewhere = Boolean(
        active &&
          active !== document.body &&
          !insideComposer &&
          (active.matches("input, textarea, select") ||
            active.isContentEditable ||
            active.closest("[role='dialog'], [popover]")),
      );
      if (!editingElsewhere) queueMicrotask(focus);
    }
    sawRunning = running;
  });

  const setAttachments = (next: readonly ChatAttachment[]) =>
    props.onAttachmentsChange?.(next);

  const runFiles = async (files: FileList | readonly File[]) => {
    if (!canSelectFiles()) return;
    const selected = Array.from(files);
    if (selected.length === 0) return;
    setAddingFiles(true);
    try {
      await props.fileSelection?.onSelect(selected);
    } catch (error) {
      const report = props.fileSelection?.onError ?? props.onError;
      report?.(error);
    } finally {
      setAddingFiles(false);
      if (fileInputRef) fileInputRef.value = "";
      queueMicrotask(focus);
    }
  };

  const submit = async () => {
    if (!canSubmit()) return;
    const steering = Boolean(props.running && props.onSteer);
    const previousValue = props.value;
    const previousAttachments = attachments();
    const text = previousValue.trim();

    setSubmitting(true);
    try {
      await runChatSubmission({
        clear: () => {
          props.onValueChange("");
          if (!steering) setAttachments([]);
        },
        perform: () =>
          steering
            ? props.onSteer?.(text)
            : props.onSend({ text, attachments: previousAttachments }),
        restore: () => {
          props.onValueChange(previousValue);
          if (!steering) setAttachments(previousAttachments);
        },
        onError: (error) => props.onError?.(error),
      });
    } finally {
      setSubmitting(false);
      queueMicrotask(() => {
        autoResize();
        focus();
      });
    }
  };

  const executeCommand = async (command: ChatCommand) => {
    props.onValueChange("");
    try {
      await command.action({
        setValue: props.onValueChange,
        submit: () => void submit(),
        focus,
      });
    } catch (error) {
      props.onError?.(error);
    }
    queueMicrotask(() => {
      autoResize();
      focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const matches = commandMatches();
    if (matches.length > 0) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        setSelectedCommandIndex((index) =>
          nextChatCommandIndex(index, matches.length, direction),
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const command = selectedCommand();
        if (command) void executeCommand(command);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        props.onValueChange("");
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section
      ref={composerRef}
      class={`k2b-chat-composer ${props.class ?? ""}`}
      data-running={props.running ? "true" : undefined}
      data-drag-active={dragActive() ? "true" : undefined}
      role="group"
      aria-label={props.label ?? "Message composer"}
    >
      <Show when={commandsOpen()}>
        <div id={commandListId} class="k2b-chat-composer__commands" role="listbox" aria-label="Commands">
          <For each={commandMatches()}>
            {(command, index) => (
              <button
                id={`${commandListId}-${index()}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index() === selectedCommandIndex()}
                data-active={index() === selectedCommandIndex() ? "true" : undefined}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void executeCommand(command)}
              >
                <i class={command.icon ?? "ti ti-slash"} aria-hidden="true" />
                <span>
                  <strong>/{command.name}</strong>
                  <small>{command.description}</small>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={attachments().length > 0}>
        <div class="k2b-chat-composer__attachments" role="list" aria-label="Attachments">
          <For each={attachments()}>
            {(attachment) => (
              <div class="k2b-chat-composer__attachment" role="listitem">
                <Show
                  when={attachment.kind === "image" && attachment.previewUrl}
                  fallback={<i class={attachmentIcon(attachment)} aria-hidden="true" />}
                >
                  <img src={attachment.previewUrl} alt="" />
                </Show>
                <span>
                  <strong title={attachment.name}>{attachment.name}</strong>
                  <Show when={formatBytes(attachment.size)}>
                    {(size) => <small>{size()}</small>}
                  </Show>
                </span>
                <Show when={props.onAttachmentsChange}>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    disabled={blocked()}
                    onClick={() =>
                      setAttachments(attachments().filter((candidate) => candidate.id !== attachment.id))
                    }
                  >
                    <i class="ti ti-x" aria-hidden="true" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div
        class="k2b-chat-composer__input"
        role="group"
        aria-label="Message input"
        onDragEnter={(event) => {
          if (!canSelectFiles() || !event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!canSelectFiles() || !event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          setDragActive(false);
          if (canSelectFiles() && event.dataTransfer.files.length) {
            void runFiles(event.dataTransfer.files);
          }
        }}
      >
        <Show when={dragActive()}>
          <div class="k2b-chat-composer__drop" aria-hidden="true">
            Drop files to attach
          </div>
        </Show>
        {/* Biome cannot infer that the ARIA popup attributes disappear together with the conditional combobox role. */}
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the rendered DOM only receives these attributes while role=combobox */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={props.value}
          disabled={blocked()}
          placeholder={props.placeholder ?? "Write a message or type / for commands"}
          aria-label={props.inputLabel ?? "Message"}
          role={commandsOpen() ? "combobox" : undefined}
          aria-autocomplete={commandsOpen() ? "list" : undefined}
          aria-controls={commandsOpen() ? commandListId : undefined}
          aria-expanded={commandsOpen() ? "true" : undefined}
          aria-activedescendant={
            selectedCommand() ? `${commandListId}-${selectedCommandIndex()}` : undefined
          }
          onInput={(event) => {
            props.onValueChange(event.currentTarget.value);
            autoResize();
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      <Show when={props.error}>
        <div class="k2b-chat-composer__error" role="alert">
          <i class="ti ti-alert-circle" aria-hidden="true" />
          {props.error}
        </div>
      </Show>

      <footer class="k2b-chat-composer__footer">
        <div class="k2b-chat-composer__tools">
          <Show when={props.fileSelection}>
            <button
              type="button"
              class="k2b-chat-composer__icon-action"
              disabled={!canSelectFiles()}
              aria-label={props.fileSelection?.label ?? "Attach files"}
              title={props.fileSelection?.label ?? "Attach files"}
              onClick={() => fileInputRef?.click()}
            >
              <i class={addingFiles() ? "ti ti-loader-2 k2b-spin" : "ti ti-paperclip"} aria-hidden="true" />
            </button>
            <input
              ref={fileInputRef}
              class="k2b-sr-only"
              type="file"
              tabIndex={-1}
              aria-hidden="true"
              accept={props.fileSelection?.accept}
              multiple={props.fileSelection?.multiple ?? true}
              onChange={(event) => {
                if (event.currentTarget.files?.length) void runFiles(event.currentTarget.files);
              }}
            />
          </Show>
          <Show when={(props.models?.length ?? 0) > 0}>
            <Select
              class="k2b-chat-composer__model"
              label={false}
              options={modelOptions()}
              value={props.selectedModelId ?? null}
              onValueChange={(value) => {
                if (!value) return;
                props.onModelChange?.(value);
                queueMicrotask(focus);
              }}
              disabled={blocked() || props.running || !props.onModelChange}
              placeholder="Model"
            />
          </Show>
          {props.actions}
        </div>

        <div class="k2b-chat-composer__submit">
          {props.context}
          <Show when={props.running && props.onStop}>
            <button
              type="button"
              class="k2b-chat-composer__icon-action"
              data-tone="danger"
              disabled={props.stopping}
              aria-label={props.stopping ? "Stopping" : "Stop"}
              title={props.stopping ? "Stopping" : "Stop"}
              onClick={() => reportChatFailure(() => props.onStop?.(), props.onError)}
            >
              <i class={props.stopping ? "ti ti-loader-2 k2b-spin" : "ti ti-player-stop"} aria-hidden="true" />
            </button>
          </Show>
          <button
            type="button"
            class="k2b-chat-composer__send"
            disabled={!canSubmit()}
            aria-label={
              addingFiles()
                ? "Adding files"
                : submitting()
                  ? props.running
                    ? "Steering"
                    : "Sending"
                  : props.running
                    ? "Steer response"
                    : "Send message"
            }
            title={props.running ? "Steer response" : "Send message"}
            onClick={() => void submit()}
          >
            <i
              class={
                addingFiles() || submitting()
                  ? "ti ti-loader-2 k2b-spin"
                  : props.running
                    ? "ti ti-route"
                    : "ti ti-arrow-up"
              }
              aria-hidden="true"
            />
          </button>
        </div>
      </footer>
    </section>
  );
}
