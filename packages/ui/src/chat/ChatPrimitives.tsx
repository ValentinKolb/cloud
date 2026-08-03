import { createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { Dropdown, type DropdownItem } from "../actions/Dropdown";
import { Tooltip } from "../feedback/Tooltip";
import { ProgressBar } from "../surfaces/ProgressBar";
import type { ChatAction, ChatActivityTone, ChatAttachment, ChatContextUsageData, ChatMessageStatus, ChatRole } from "./types";

export type ChatMessageProps = {
  role: ChatRole;
  children?: JSX.Element;
  label?: string;
  createdAt?: string | Date;
  timeLabel?: string;
  status?: ChatMessageStatus;
  attachments?: readonly ChatAttachment[];
  actions?: readonly ChatAction[];
  actionDisplay?: "auto" | "inline" | "menu";
  anchorId?: string | number;
  onActionError?: (error: unknown) => void;
  class?: string;
};

export type ChatActivityProps = {
  label: string;
  description?: string;
  icon?: string;
  tone?: ChatActivityTone;
  trailing?: JSX.Element;
  defaultOpen?: boolean;
  anchorId?: string | number;
  children?: JSX.Element;
  class?: string;
};

export type ChatContextUsageProps = ChatContextUsageData & { class?: string };

const roleLabel = (role: ChatRole): string => {
  if (role === "assistant") return "Assistant";
  if (role === "user") return "User";
  if (role === "tool") return "Tool";
  return "System";
};

const statusLabel = (status: ChatMessageStatus | undefined): string | null => {
  if (status === "pending") return "Waiting";
  if (status === "streaming") return "Generating";
  if (status === "error") return "Failed";
  return null;
};

const statusIcon = (status: ChatMessageStatus | undefined): string => {
  if (status === "pending") return "ti ti-clock";
  if (status === "streaming") return "ti ti-loader-2";
  return "ti ti-alert-circle";
};

const attachmentIcon = (attachment: ChatAttachment): string =>
  attachment.icon ?? (attachment.kind === "image" ? "ti ti-photo" : "ti ti-file");

const finiteNonNegative = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

export const formatChatTokens = (tokens: number): string => {
  const value = finiteNonNegative(tokens);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
};

const dateTime = (value: string | Date | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const visibleTime = (value: string | Date | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date) : null;
};

const writeClipboard = async (value: string): Promise<void> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable.");
  }
  await navigator.clipboard.writeText(value);
};

export function ChatMessage(props: ChatMessageProps): JSX.Element {
  const [busyActionId, setBusyActionId] = createSignal<string | null>(null);
  const [completedActionId, setCompletedActionId] = createSignal<string | null>(null);
  let completedTimer: ReturnType<typeof setTimeout> | undefined;
  const status = () => statusLabel(props.status);
  const timestamp = () => dateTime(props.createdAt);
  const time = () => props.timeLabel ?? visibleTime(props.createdAt);
  const actions = () => props.actions ?? [];
  const actionDisplay = () =>
    props.actionDisplay === "auto" || !props.actionDisplay ? (props.role === "user" ? "menu" : "inline") : props.actionDisplay;

  const runAction = async (action: ChatAction) => {
    if (action.disabled || busyActionId()) return;
    setBusyActionId(action.id);
    try {
      if (action.copyText !== undefined) await writeClipboard(action.copyText);
      else await action.onSelect?.();
      setCompletedActionId(action.id);
      if (completedTimer) clearTimeout(completedTimer);
      completedTimer = setTimeout(() => setCompletedActionId(null), 1400);
    } catch (error) {
      props.onActionError?.(error);
    } finally {
      setBusyActionId(null);
    }
  };

  const actionIcon = (action: ChatAction) =>
    busyActionId() === action.id
      ? "ti ti-loader-2 k2b-spin"
      : completedActionId() === action.id
        ? "ti ti-check"
        : (action.icon ?? "ti ti-dots");

  onCleanup(() => {
    if (completedTimer) clearTimeout(completedTimer);
  });

  const menuItems = (): readonly DropdownItem[] =>
    actions().map((action) => ({
      icon: actionIcon(action),
      label: action.label,
      variant: action.variant,
      disabled: action.disabled || Boolean(busyActionId()),
      action: () => void runAction(action),
    }));

  return (
    <article
      class={`k2b-chat-message ${props.class ?? ""}`}
      data-role={props.role}
      data-status={props.status ?? "complete"}
      data-chat-anchor={props.anchorId !== undefined ? String(props.anchorId) : undefined}
      aria-busy={props.status === "pending" || props.status === "streaming" ? "true" : undefined}
    >
      <span class="k2b-sr-only">{props.label ?? roleLabel(props.role)}: </span>
      <Show when={(props.attachments?.length ?? 0) > 0}>
        <div class="k2b-chat-message__attachments" role="list" aria-label="Attachments">
          <For each={props.attachments}>
            {(attachment) => (
              <div class="k2b-chat-message__attachment" role="listitem" title={attachment.name}>
                <Show
                  when={attachment.kind === "image" && attachment.previewUrl}
                  fallback={<i class={attachmentIcon(attachment)} aria-hidden="true" />}
                >
                  <img src={attachment.previewUrl} alt={attachment.alt ?? attachment.name} />
                </Show>
                <Show when={attachment.kind !== "image"}>
                  <span>{attachment.name}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.children !== undefined && props.children !== null && props.children !== ""}>
        <div class="k2b-chat-message__bubble">
          <div class="k2b-chat-message__content">{props.children}</div>
        </div>
      </Show>

      <footer class="k2b-chat-message__meta">
        <Show when={status()}>
          {(label) => (
            <span class="k2b-chat-message__status" role={props.status === "error" ? "alert" : "status"}>
              <i class={`${statusIcon(props.status)} ${props.status === "streaming" ? "k2b-spin" : ""}`} aria-hidden="true" />
              {label()}
            </span>
          )}
        </Show>
        <Show when={time()}>{(label) => <time dateTime={timestamp() ?? undefined}>{label()}</time>}</Show>
        <Show when={actions().length > 0 && actionDisplay() === "inline"}>
          <span class="k2b-chat-message__actions" role="group" aria-label="Message actions">
            <For each={actions()}>
              {(action) => (
                <button
                  type="button"
                  aria-label={action.label}
                  title={action.label}
                  data-danger={action.variant === "danger" ? "true" : undefined}
                  disabled={action.disabled || Boolean(busyActionId())}
                  onClick={() => void runAction(action)}
                >
                  <i class={actionIcon(action)} aria-hidden="true" />
                </button>
              )}
            </For>
          </span>
        </Show>
        <Show when={actions().length > 0 && actionDisplay() === "menu"}>
          <Dropdown
            position="bottom-left"
            width="12rem"
            label="Message actions"
            elements={menuItems()}
            trigger={
              <button type="button" class="k2b-chat-message__menu" aria-label="Message actions" title="Message actions">
                <i class="ti ti-dots" aria-hidden="true" />
              </button>
            }
          />
        </Show>
      </footer>
    </article>
  );
}

const ActivityContent = (props: ChatActivityProps & { disclosure?: boolean }) => (
  <>
    <i class={props.icon ?? "ti ti-sparkles"} aria-hidden="true" />
    <span class="k2b-chat-activity__copy">
      <strong>{props.label}</strong>
      <Show when={props.description}>{(description) => <small>{description()}</small>}</Show>
    </span>
    <Show when={props.trailing}>
      <span class="k2b-chat-activity__trailing">{props.trailing}</span>
    </Show>
    <Show when={props.disclosure}>
      <i class="ti ti-chevron-right k2b-chat-activity__chevron" aria-hidden="true" />
    </Show>
  </>
);

export function ChatActivity(props: ChatActivityProps): JSX.Element {
  const tone = () => props.tone ?? "neutral";
  return (
    <Show
      when={props.children}
      fallback={
        <div
          class={`k2b-chat-activity ${props.class ?? ""}`}
          data-tone={tone()}
          data-chat-anchor={props.anchorId !== undefined ? String(props.anchorId) : undefined}
        >
          <div class="k2b-chat-activity__row">
            <ActivityContent {...props} />
          </div>
        </div>
      }
    >
      <details
        class={`k2b-chat-activity ${props.class ?? ""}`}
        data-tone={tone()}
        data-chat-anchor={props.anchorId !== undefined ? String(props.anchorId) : undefined}
        open={props.defaultOpen}
      >
        <summary class="k2b-chat-activity__row">
          <ActivityContent {...props} disclosure />
        </summary>
        <div class="k2b-chat-activity__body">{props.children}</div>
      </details>
    </Show>
  );
}

export function ChatContextUsage(props: ChatContextUsageProps): JSX.Element {
  const total = () =>
    finiteNonNegative(props.usage?.total ?? finiteNonNegative(props.usage?.input) + finiteNonNegative(props.usage?.output));
  const windowSize = () => finiteNonNegative(props.contextWindow);
  const reported = () => total() > 0;
  const percent = () => (reported() && windowSize() > 0 ? Math.min(100, Math.round((total() / windowSize()) * 100)) : null);
  const remaining = () => (reported() && windowSize() > 0 ? Math.max(0, windowSize() - total()) : null);
  const accessibleLabel = () => {
    if (!reported()) {
      return windowSize() > 0
        ? `Context usage unavailable, ${windowSize().toLocaleString()} token context window`
        : "Context usage unavailable";
    }
    const usage = `${total().toLocaleString()} tokens used`;
    return percent() === null ? usage : `${usage}, ${percent()}% of the context window`;
  };

  return (
    <Tooltip
      placement="top"
      class={props.class}
      content={
        <div class="k2b-chat-context__tooltip">
          <strong>Last request context</strong>
          <Show when={percent() !== null}>
            <ProgressBar value={percent() ?? 0} size="xs" tone={(percent() ?? 0) >= 85 ? "danger" : "info"} label="Context window used" />
          </Show>
          <dl>
            <Show when={props.modelLabel}>
              {(model) => (
                <div>
                  <dt>Model</dt>
                  <dd>{model()}</dd>
                </div>
              )}
            </Show>
            <div>
              <dt>Input</dt>
              <dd>{props.usage?.input?.toLocaleString() ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{props.usage?.output?.toLocaleString() ?? "Unknown"}</dd>
            </div>
            <Show when={finiteNonNegative(props.loopUsage?.total) > 0}>
              <div>
                <dt>Loop total</dt>
                <dd>{finiteNonNegative(props.loopUsage?.total).toLocaleString()}</dd>
              </div>
            </Show>
            <div>
              <dt>Window</dt>
              <dd>{windowSize() > 0 ? windowSize().toLocaleString() : "Not configured"}</dd>
            </div>
            <Show when={remaining() !== null}>
              <div>
                <dt>Remaining</dt>
                <dd>{remaining()?.toLocaleString()}</dd>
              </div>
            </Show>
          </dl>
        </div>
      }
    >
      <button
        type="button"
        class="k2b-chat-context"
        data-warning={reported() && (percent() ?? 0) >= 85 ? "true" : undefined}
        aria-label={accessibleLabel()}
      >
        <i class="ti ti-brain" aria-hidden="true" />
        <span>{percent() === null ? "–" : `${percent()}%`}</span>
      </button>
    </Tooltip>
  );
}
