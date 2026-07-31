import { type JSX, Show } from "solid-js";
import { Tooltip } from "../feedback/Tooltip";
import { ProgressBar } from "../surfaces/ProgressBar";

export type ChatRole = "user" | "assistant" | "system" | "tool";
export type ChatMessageStatus = "pending" | "streaming" | "complete" | "error";
export type ChatActivityTone = "neutral" | "ai" | "success" | "danger";

export type ChatUsage = {
  input?: number;
  output?: number;
  total?: number;
};

export type ChatMessageProps = {
  role: ChatRole;
  content: JSX.Element;
  label?: string;
  createdAt?: string | Date;
  timeLabel?: string;
  status?: ChatMessageStatus;
  actions?: JSX.Element;
  class?: string;
};

export type ChatActivityProps = {
  label: string;
  description?: string;
  icon?: string;
  tone?: ChatActivityTone;
  trailing?: JSX.Element;
  defaultOpen?: boolean;
  children?: JSX.Element;
  class?: string;
};

export type ChatContextUsageProps = {
  usage?: ChatUsage | null;
  loopUsage?: ChatUsage | null;
  contextWindow?: number;
  modelLabel?: string;
  class?: string;
};

const roleLabel = (role: ChatRole): string => {
  if (role === "assistant") return "Assistant";
  if (role === "user") return "You";
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
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date)
    : null;
};

export function ChatMessage(props: ChatMessageProps): JSX.Element {
  const status = () => statusLabel(props.status);
  const timestamp = () => dateTime(props.createdAt);
  const time = () => props.timeLabel ?? visibleTime(props.createdAt);

  return (
    <article
      class={`k2b-chat-message ${props.class ?? ""}`}
      data-role={props.role}
      data-status={props.status ?? "complete"}
      aria-busy={props.status === "pending" || props.status === "streaming" ? "true" : undefined}
    >
      <header class="k2b-chat-message__meta">
        <strong>{props.label ?? roleLabel(props.role)}</strong>
        <Show when={status()}>
          {(label) => (
            <span class="k2b-chat-message__status" role={props.status === "error" ? "alert" : "status"}>
              <i
                class={`${statusIcon(props.status)} ${props.status === "streaming" ? "k2b-spin" : ""}`}
                aria-hidden="true"
              />
              {label()}
            </span>
          )}
        </Show>
        <Show when={time()}>
          {(label) => <time dateTime={timestamp() ?? undefined}>{label()}</time>}
        </Show>
      </header>
      <div class="k2b-chat-message__content">{props.content}</div>
      <Show when={props.actions}>
        <footer class="k2b-chat-message__actions">{props.actions}</footer>
      </Show>
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
        <div class={`k2b-chat-activity ${props.class ?? ""}`} data-tone={tone()}>
          <div class="k2b-chat-activity__row">
            <ActivityContent {...props} />
          </div>
        </div>
      }
    >
      <details
        class={`k2b-chat-activity ${props.class ?? ""}`}
        data-tone={tone()}
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
    finiteNonNegative(
      props.usage?.total ??
        finiteNonNegative(props.usage?.input) + finiteNonNegative(props.usage?.output),
    );
  const windowSize = () => finiteNonNegative(props.contextWindow);
  const percent = () =>
    windowSize() > 0 ? Math.min(100, Math.round((total() / windowSize()) * 100)) : null;
  const remaining = () => (windowSize() > 0 ? Math.max(0, windowSize() - total()) : null);
  const reported = () => total() > 0;
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
            <ProgressBar
              value={percent() ?? 0}
              size="xs"
              tone={(percent() ?? 0) >= 85 ? "danger" : "info"}
              label="Context window used"
            />
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
        <span>{reported() ? formatChatTokens(total()) : "Context"}</span>
        <Show when={reported() && percent() !== null}>
          <small>{percent()}%</small>
        </Show>
      </button>
    </Tooltip>
  );
}
