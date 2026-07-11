import type { Message, Usage } from "@valentinkolb/nessi";
import { clipboard, mutation } from "@valentinkolb/stdlib/solid";
import { createContext, For, type JSX, Show, useContext } from "solid-js";
import { dialogCore, PanelDialog, panelDialogOptions, prompts, StatCell, StatGrid } from "../../ui";
import type { AiTurnBlock } from "../protocol";
import type { AiStoredMessage } from "../types";
import { type AiForkMessageInput, type AiRetryMessageInput, displayToolName, formatWorkedDuration } from "./message-utils";

/** The active-turn coordinates an approval/tool action needs to resolve on the server. */
export type AiTurnActionRequest = { turnId: string; callId: string; name: string };

type ApprovalHandler = (request: AiTurnActionRequest, input: { approved: boolean; remember?: "always" }) => void | Promise<void>;
type FrontendToolResultHandler = (request: AiTurnActionRequest, result: unknown) => void | Promise<void>;
type ForkMessageHandler = (entry: AiStoredMessage, input?: AiForkMessageInput) => void | Promise<void>;
type RetryMessageHandler = (entry: AiStoredMessage, input?: AiRetryMessageInput) => void | Promise<void>;
type RetrySteerHandler = (block: Extract<AiTurnBlock, { kind: "steer_message" }>) => void | Promise<void>;

export type AiMessageListActions = {
  /** Prevents turn-continuation actions while the current turn is stopping. */
  actionDisabled?: () => boolean;
  onApproval?: ApprovalHandler;
  onFrontendToolResult?: FrontendToolResultHandler;
  onForkMessage?: ForkMessageHandler;
  onRetryMessage?: RetryMessageHandler;
  onRetrySteer?: RetrySteerHandler;
  /** Download URL for a conversation VFS file (present blocks, attachment chips). */
  fileUrl?: (path: string) => string | null;
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

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const assistantResponseInfo = (entries: AiStoredMessage[]) => {
  const assistantEntries = entries.filter((entry) => entry.kind === "message" && entry.message.role === "assistant");
  const entry = assistantEntries.findLast((candidate) => candidate.loopAggregate) ?? assistantEntries.at(-1) ?? entries.at(-1);
  if (!entry) return null;

  const blocks = assistantEntries.flatMap((candidate) => assistantBlocks(candidate.message));
  const toolCalls = blocks.filter((block) => block.type === "tool_call");
  const aggregate = entry.loopAggregate;
  const usage = aggregate?.usage ?? entry.usage;
  const credits = usageValue(usage, "creditsUsed");
  const timing = aggregate?.timing;

  const meta = [
    { label: "Provider model", value: entry.providerModel ?? "Unknown" },
    { label: "Model profile", value: entry.modelProfileId ?? "Unknown" },
    { label: "Loop id", value: entry.loopId ?? "Legacy message" },
    { label: "Finished", value: `${entry.loopDoneReason ?? "unknown"} · ${entry.stopReason ?? "unknown"}` },
    { label: "Created", value: formatDateTime(entry.createdAt) },
  ];

  const issues = [
    { label: "errors", count: aggregate?.toolErrorCount ?? 0 },
    { label: "stream issues", count: aggregate?.toolIssueCount ?? 0 },
    { label: "malformed", count: aggregate?.toolMalformedCount ?? 0 },
    { label: "cancelled", count: aggregate?.toolCancelledCount ?? 0 },
  ].filter((issue) => issue.count > 0);

  const toolCounts = new Map<string, number>();
  for (const tool of aggregate?.turns.flatMap((turn) => turn.toolCalls) ?? toolCalls) {
    toolCounts.set(tool.name, (toolCounts.get(tool.name) ?? 0) + 1);
  }

  return {
    meta,
    timing,
    usage: {
      input: usageValue(usage, "input"),
      output: usageValue(usage, "output"),
      total: usageValue(usage, "total"),
      credits,
    },
    turns: aggregate?.assistantMessageCount ?? 1,
    toolCallCount: aggregate?.toolCallCount ?? toolCalls.length,
    issues,
    tools: [...toolCounts.entries()].map(([name, count]) => ({ name, count })),
  };
};

const openAssistantResponseInfo = (entries: AiStoredMessage[]) => {
  const info = assistantResponseInfo(entries);
  if (!info) return;

  const tokens = (value: number | null) => value?.toLocaleString() ?? "–";
  const issueSummary = info.issues.map((issue) => `${issue.count} ${issue.label}`).join(" · ");
  const issueTotal = info.issues.reduce((sum, issue) => sum + issue.count, 0);

  void dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="Message info" subtitle="Assistant response metadata" icon="ti ti-info-circle" close={close} />
        <PanelDialog.Body>
          <PanelDialog.Section title="Details" icon="ti ti-list-details">
            <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-1.5 text-sm">
              <For each={info.meta}>
                {(row) => (
                  <>
                    <dt class="text-dimmed">{row.label}</dt>
                    <dd class="min-w-0 truncate text-right text-primary" title={row.value}>
                      {row.value}
                    </dd>
                  </>
                )}
              </For>
            </dl>
          </PanelDialog.Section>

          <Show when={info.timing}>
            {(timing) => (
              <StatGrid title="Timing" columns={3} surface="muted">
                {/* Worked = generation + tool execution; waiting for approvals/client tools is listed separately. */}
                <StatCell label="Worked" value={formatWorkedDuration(timing().totalElapsedMs)} sub="generation + tools" />
                <StatCell label="Generation" value={formatWorkedDuration(timing().generationMs)} />
                <StatCell
                  label="Tool execution"
                  value={timing().toolExecutionMs > 0 ? formatWorkedDuration(timing().toolExecutionMs) : "–"}
                />
                <StatCell
                  label="Waiting for user"
                  value={timing().actionWaitMs > 0 ? formatWorkedDuration(timing().actionWaitMs) : "–"}
                  sub="approvals & inputs"
                />
                <StatCell label="Wall clock" value={formatWorkedDuration(timing().wallMs)} />
                <StatCell
                  label="Output speed"
                  value={
                    timing().outputTokensPerSecond !== undefined
                      ? `${timing().outputTokensPerSecond?.toLocaleString(undefined, { maximumFractionDigits: 1 })} tok/s`
                      : "–"
                  }
                />
              </StatGrid>
            )}
          </Show>

          <StatGrid title="Usage" columns={3} surface="muted">
            <StatCell label="Input tokens" value={tokens(info.usage.input)} />
            <StatCell label="Output tokens" value={tokens(info.usage.output)} />
            <StatCell label="Total tokens" value={tokens(info.usage.total)} />
            <StatCell label="Assistant turns" value={info.turns.toLocaleString()} />
            <StatCell label="Tool calls" value={info.toolCallCount.toLocaleString()} />
            <Show
              when={info.issues.length > 0}
              fallback={<StatCell label="Tool issues" value="None" accent={{ tone: "emerald", icon: "ti ti-check", text: "ok" }} />}
            >
              <StatCell
                label="Tool issues"
                value={issueTotal.toLocaleString()}
                sub={issueSummary}
                accent={{ tone: "red", icon: "ti ti-alert-triangle" }}
              />
            </Show>
            <Show when={info.usage.credits !== null && info.usage.credits > 0}>
              <StatCell label="Credits" value={info.usage.credits?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "–"} />
            </Show>
          </StatGrid>

          <Show when={info.tools.length > 0}>
            <PanelDialog.Section title="Tools" icon="ti ti-tool" subtitle="Tools requested by this assistant loop.">
              <div class="flex flex-wrap gap-1.5">
                <For each={info.tools}>
                  {(tool) => (
                    <span class="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs text-secondary dark:bg-zinc-900">
                      <i class="ti ti-tool text-sm" aria-hidden="true" />
                      {displayToolName(tool.name)}
                      <Show when={tool.count > 1}>
                        <span class="rounded bg-white px-1 font-medium tabular-nums text-dimmed dark:bg-zinc-950">×{tool.count}</span>
                      </Show>
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

const openForkMessageDialog = async (
  entry: AiStoredMessage,
  copyText: string,
  onForkMessage: (entry: AiStoredMessage, input?: AiForkMessageInput) => void | Promise<void>,
) => {
  const result = await prompts.form({
    title: "Fork chat",
    icon: "ti ti-git-fork",
    confirmText: "Fork",
    size: "medium",
    fields: {
      title: {
        type: "text",
        label: "Chat name",
        default: forkTitleFromText(copyText),
        required: true,
        maxLength: 120,
      },
    },
  });
  const title = result?.title.trim();
  if (title) await onForkMessage(entry, { title });
};

export function AssistantMessageActions(props: { entry: AiStoredMessage; entries: AiStoredMessage[]; copyText: string }) {
  const actions = useAiMessageActions();
  const { copy, wasCopied } = clipboard.create(1400);
  const fork = mutation.create<void, void>({
    mutation: async () => {
      if (actions.onForkMessage) await openForkMessageDialog(props.entry, props.copyText, actions.onForkMessage);
    },
  });
  const forkFailed = () => Boolean(fork.error());

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
        <button
          type="button"
          class={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-900 ${
            forkFailed() ? "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300" : "hover:text-primary"
          }`}
          aria-label={forkFailed() ? "Fork failed. Try again" : "Fork conversation"}
          title={forkFailed() ? "Fork failed. Try again" : "Fork"}
          disabled={fork.loading()}
          onClick={() => {
            if (!fork.loading()) void fork.mutate();
          }}
        >
          <i
            class={`ti ${fork.loading() ? "ti-loader-2 animate-spin" : forkFailed() ? "ti-alert-circle" : "ti-git-fork"} text-sm`}
            aria-hidden="true"
          />
        </button>
      </Show>
    </div>
  );
}
