import type { Message, Usage } from "@valentinkolb/nessi";
import { clipboard } from "@valentinkolb/stdlib/solid";
import { createContext, createSignal, For, type JSX, Show, useContext } from "solid-js";
import { dialogCore, PanelDialog, panelDialogOptions, TextInput } from "../../ui";
import { copyTextFromAssistantEntries } from "../timeline";
import type { AiStoredMessage } from "../types";
import { type AiForkMessageInput, type AiRetryMessageInput, displayToolName } from "./message-utils";

/** The active-turn coordinates an approval/tool action needs to resolve on the server. */
export type AiTurnActionRequest = { turnId: string; callId: string; name: string };

type ApprovalHandler = (request: AiTurnActionRequest, input: { approved: boolean; remember?: "always" }) => void | Promise<void>;
type FrontendToolResultHandler = (request: AiTurnActionRequest, result: unknown) => void | Promise<void>;
type ForkMessageHandler = (entry: AiStoredMessage, input?: AiForkMessageInput) => void | Promise<void>;
type RetryMessageHandler = (entry: AiStoredMessage, input?: AiRetryMessageInput) => void | Promise<void>;

export type AiMessageListActions = {
  onApproval?: ApprovalHandler;
  onFrontendToolResult?: FrontendToolResultHandler;
  onForkMessage?: ForkMessageHandler;
  onRetryMessage?: RetryMessageHandler;
};

const assistantBlocks = (message: Message): Extract<Message, { role: "assistant" }>["content"] =>
  message.role === "assistant" ? message.content : [];

const AiMessageActionContext = createContext<AiMessageListActions>({});

export const useAiMessageActions = () => useContext(AiMessageActionContext);

export function AiMessageActionsProvider(props: { actions?: AiMessageListActions; children: JSX.Element }) {
  return <AiMessageActionContext.Provider value={props.actions ?? {}}>{props.children}</AiMessageActionContext.Provider>;
}

const usageValue = (usage: Usage | null | undefined, key: "input" | "output" | "total" | "creditsUsed") => {
  const value = (usage as Partial<Record<"input" | "output" | "total" | "creditsUsed", unknown>> | null | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const estimateTokens = (text: string): number => Math.max(0, Math.ceil(text.trim().length / 4));
const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

type AssistantResponseInfoStat = { label: string; value: string };

const assistantResponseInfo = (entries: AiStoredMessage[]) => {
  const assistantEntries = entries.filter((entry) => entry.kind === "message" && entry.message.role === "assistant");
  const entry = assistantEntries.findLast((candidate) => candidate.loopAggregate) ?? assistantEntries.at(-1) ?? entries.at(-1);
  if (!entry) return null;

  const text = copyTextFromAssistantEntries(entries);
  const blocks = assistantEntries.flatMap((candidate) => assistantBlocks(candidate.message));
  const toolCalls = blocks.filter((block) => block.type === "tool_call");
  const aggregate = entry.loopAggregate;
  const aggregateToolCalls = aggregate?.turns.flatMap((turn) => turn.toolCalls) ?? null;
  const usage = aggregate?.usage ?? entry.usage;
  const thinkingBlocks = blocks.filter((block) => block.type === "thinking");
  const credits = usageValue(usage, "creditsUsed");
  const stats: AssistantResponseInfoStat[] = [
    { label: "Provider model", value: entry.providerModel ?? "Unknown" },
    { label: "Model profile", value: entry.modelProfileId ?? "Unknown" },
    { label: "Loop id", value: entry.loopId ?? "Legacy message" },
    { label: "Loop done reason", value: entry.loopDoneReason ?? "Unknown" },
    { label: "Stop reason", value: entry.stopReason ?? "Unknown" },
    { label: "Created", value: formatDateTime(entry.createdAt) },
    { label: "Input tokens", value: usageValue(usage, "input")?.toLocaleString() ?? "Not reported" },
    { label: "Output tokens", value: usageValue(usage, "output")?.toLocaleString() ?? "Not reported" },
    { label: "Total tokens", value: usageValue(usage, "total")?.toLocaleString() ?? "Not reported" },
    { label: "Credits", value: credits !== null ? credits.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "Not reported" },
    { label: "Words", value: wordCount(text).toLocaleString() },
    { label: "Characters", value: text.length.toLocaleString() },
    { label: "Estimated tokens", value: estimateTokens(text).toLocaleString() },
    { label: "Assistant turns", value: (aggregate?.assistantMessageCount ?? 1).toLocaleString() },
    { label: "Thinking blocks", value: thinkingBlocks.length.toLocaleString() },
    { label: "Tool calls", value: (aggregate?.toolCallCount ?? toolCalls.length).toLocaleString() },
    { label: "Tool errors", value: (aggregate?.toolErrorCount ?? 0).toLocaleString() },
    { label: "Tool stream issues", value: (aggregate?.toolIssueCount ?? 0).toLocaleString() },
    { label: "Malformed tool streams", value: (aggregate?.toolMalformedCount ?? 0).toLocaleString() },
    { label: "Cancelled tool streams", value: (aggregate?.toolCancelledCount ?? 0).toLocaleString() },
  ];

  return { stats, tools: aggregateToolCalls ?? toolCalls };
};

const openAssistantResponseInfo = (entries: AiStoredMessage[]) => {
  const info = assistantResponseInfo(entries);
  if (!info) return;

  void dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="Message info" subtitle="Assistant response metadata" icon="ti ti-info-circle" close={close} />
        <PanelDialog.Body>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <For each={info.stats}>
              {(stat) => (
                <div class="rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                  <p class="text-[11px] uppercase tracking-[0.08em] text-dimmed">{stat.label}</p>
                  <p class="mt-0.5 truncate text-sm font-medium text-primary" title={stat.value}>
                    {stat.value}
                  </p>
                </div>
              )}
            </For>
          </div>
          <Show when={info.tools.length > 0}>
            <PanelDialog.Section title="Tools" icon="ti ti-tool" subtitle="Tools requested by this assistant loop.">
              <div class="flex flex-wrap gap-1.5">
                <For each={info.tools}>
                  {(tool) => (
                    <span class="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs text-secondary dark:bg-zinc-900">
                      <i class="ti ti-tool text-sm" aria-hidden="true" />
                      {displayToolName(tool.name)}
                    </span>
                  )}
                </For>
              </div>
            </PanelDialog.Section>
          </Show>
        </PanelDialog.Body>
      </PanelDialog>
    ),
    {
      ...panelDialogOptions,
      panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(94vw,36rem)]"),
    },
  );
};

const forkTitleFromText = (text: string): string => {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Forked chat";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77).trim()}...` : firstLine;
};

function ForkMessageDialog(props: {
  entry: AiStoredMessage;
  copyText: string;
  close: () => void;
  onForkMessage: (entry: AiStoredMessage, input?: AiForkMessageInput) => void | Promise<void>;
}) {
  const [title, setTitle] = createSignal(forkTitleFromText(props.copyText));
  const [submitting, setSubmitting] = createSignal(false);

  const submit = async () => {
    const nextTitle = title().trim();
    if (!nextTitle || submitting()) return;
    setSubmitting(true);
    try {
      await props.onForkMessage(props.entry, { title: nextTitle });
      props.close();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PanelDialog>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <PanelDialog.Header
          title="Fork chat"
          subtitle="Create a new chat that keeps the conversation up to this response."
          icon="ti ti-git-fork"
          close={props.close}
        />
        <PanelDialog.Body>
          <p class="text-sm leading-6 text-secondary">
            The new chat starts from this assistant response, so you can explore a different direction without changing the current chat.
          </p>
          <TextInput
            label="New chat name"
            value={title}
            onInput={setTitle}
            required
            maxLength={120}
            placeholder="Name for the forked chat"
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span />
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" disabled={submitting()} onClick={props.close}>
              Cancel
            </button>
            <button type="submit" class="btn-primary btn-sm" disabled={submitting() || !title().trim()}>
              <i class={submitting() ? "ti ti-loader-2 animate-spin" : "ti ti-git-fork"} />
              Fork chat
            </button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  );
}

const openForkMessageDialog = (
  entry: AiStoredMessage,
  copyText: string,
  onForkMessage: (entry: AiStoredMessage, input?: AiForkMessageInput) => void | Promise<void>,
) =>
  dialogCore.open<void>(
    (close) => <ForkMessageDialog entry={entry} copyText={copyText} onForkMessage={onForkMessage} close={() => close()} />,
    panelDialogOptions,
  );

export function AssistantMessageActions(props: { entry: AiStoredMessage; entries: AiStoredMessage[]; copyText: string }) {
  const actions = useAiMessageActions();
  const { copy, wasCopied } = clipboard.create(1400);

  return (
    <div class="pointer-events-auto flex items-center gap-0.5 text-dimmed">
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-900"
        aria-label="Message info"
        title="Info"
        onClick={() => openAssistantResponseInfo(props.entries)}
      >
        <i class="ti ti-info-circle text-sm" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-100 hover:text-primary disabled:opacity-40 dark:hover:bg-zinc-900"
        aria-label="Copy assistant message"
        title="Copy"
        disabled={!props.copyText}
        onClick={() => void copy(props.copyText)}
      >
        <i class={`ti ${wasCopied() ? "ti-check" : "ti-copy"} text-sm`} aria-hidden="true" />
      </button>
      <Show when={actions.onForkMessage}>
        {(onForkMessage) => (
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-900"
            aria-label="Fork conversation"
            title="Fork"
            onClick={() => void openForkMessageDialog(props.entry, props.copyText, onForkMessage())}
          >
            <i class="ti ti-git-fork text-sm" aria-hidden="true" />
          </button>
        )}
      </Show>
    </div>
  );
}
