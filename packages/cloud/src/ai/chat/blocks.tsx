import { For, type JSX, Match, Show, Switch } from "solid-js";
import { markdown } from "../../shared";
import type { AiTurnBlock } from "../protocol";
import { isRenderableTurnBlock } from "../protocol";
import { useAiMessageActions } from "./message-actions";
import {
  displayToolName,
  formatToolDetailText,
  isCardToolName,
  isRecord,
  isSurveyToolName,
  jsonPreview,
  toolBlockSummary,
} from "./message-utils";
import { BashToolBlock, PresentToolBlock } from "./bash-tools";
import { AssistantMarkdownBlock, ChatUtilityDisclosure, ChatUtilityLine, PulseDots } from "./primitives";
import { CloudCardBlock, CloudSurveyBlock, CloudSurveyResultBlock } from "./visual-tools";
import { WebExtractToolBlock, WebSearchToolBlock } from "./web-tools";

type ToolBlock = Extract<AiTurnBlock, { kind: "tool" }>;

// All state branches below live in reactive JSX (Show/Switch), never in the
// component body: blocks are born empty/running and mutate in place while the
// turn streams, so every branch must re-evaluate when the store updates.

function ThinkingBlockView(props: { text: string; streaming?: boolean }) {
  return (
    <Show
      when={props.text.trim()}
      fallback={
        <Show when={props.streaming}>
          <ChatUtilityLine meta={{ icon: "ti ti-sparkles", label: "Thinking", tone: "ai" }} trailing={<PulseDots />} />
        </Show>
      }
    >
      <ChatUtilityDisclosure meta={{ icon: "ti ti-sparkles", label: "Show reasoning", tone: "ai" }}>
        <pre class="max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-100/70 p-2 text-[11px] leading-5 text-secondary [box-shadow:var(--theme-recess)] dark:bg-zinc-950/70">
          {props.text}
        </pre>
      </ChatUtilityDisclosure>
    </Show>
  );
}

function CompactionBlockView(props: { block: Extract<AiTurnBlock, { kind: "compaction" }> }) {
  const status = () => props.block.status;
  const description = () => {
    if (status() === "completed") return "Context compacted";
    if (status() === "skipped") return "No-op";
    if (status() === "failed") return "Compaction failed";
    return "Compacting context";
  };

  return (
    <Show
      when={status() !== "running"}
      fallback={<ChatUtilityLine meta={{ icon: "ti ti-brain", label: "Compacting context", tone: "ai" }} trailing={<PulseDots />} />}
    >
      <ChatUtilityDisclosure
        meta={{ icon: "ti ti-brain", label: "Show compaction", description: description(), tone: status() === "failed" ? "danger" : "ai" }}
      >
        <div class="max-w-xl rounded-md bg-zinc-100/70 p-2 text-[11px] leading-5 text-secondary [box-shadow:var(--theme-recess)] dark:bg-zinc-950/70">
          <Show when={props.block.result} fallback={<p>Older chat context was summarized into compact conversation memory.</p>}>
            {(compactResult) => (
              <dl class="grid grid-cols-2 gap-2">
                <div class="rounded-md bg-white/65 px-2 py-1 dark:bg-white/5">
                  <dt class="uppercase tracking-wide text-dimmed">Before</dt>
                  <dd class="font-medium text-primary">{compactResult().entriesBefore.toLocaleString()}</dd>
                </div>
                <div class="rounded-md bg-white/65 px-2 py-1 dark:bg-white/5">
                  <dt class="uppercase tracking-wide text-dimmed">After</dt>
                  <dd class="font-medium text-primary">{compactResult().entriesAfter.toLocaleString()}</dd>
                </div>
              </dl>
            )}
          </Show>
        </div>
      </ChatUtilityDisclosure>
    </Show>
  );
}

function ToolDetailSection(props: { title: string; children: JSX.Element }) {
  return (
    <div class="min-w-0">
      <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-dimmed">{props.title}</p>
      <pre class="max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-100 p-2 text-[11px] leading-4 text-primary [box-shadow:var(--theme-recess)] dark:bg-zinc-950/70">
        {props.children}
      </pre>
    </div>
  );
}

function ToolResultDisclosure(props: { name: string; toolName: string; args?: unknown; result: unknown; isError: boolean }) {
  const summary = () => toolBlockSummary(props.result);
  return (
    <ChatUtilityDisclosure
      meta={{
        icon: `ti ${props.isError ? "ti-alert-circle" : "ti-tool"}`,
        label: props.isError ? "Show tool error" : props.name,
        description: props.isError ? `error · ${summary()}` : summary() || undefined,
        tone: props.isError ? "danger" : "neutral",
      }}
    >
      <div class="flex max-w-xl flex-col gap-2">
        <Show when={props.args !== undefined}>
          <ToolDetailSection title="Input">{formatToolDetailText(props.toolName, props.args) || jsonPreview(props.args)}</ToolDetailSection>
        </Show>
        <ToolDetailSection title="Result">{formatToolDetailText(props.toolName, props.result)}</ToolDetailSection>
      </div>
    </ChatUtilityDisclosure>
  );
}

function ApprovalBlockView(props: { turnId: string; block: ToolBlock }) {
  const actions = useAiMessageActions();
  const request = () => ({ turnId: props.turnId, callId: props.block.callId, name: props.block.name });
  const pending = () => props.block.status === "awaiting_approval";
  return (
    <div class="max-w-xl rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-100">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <p class="font-semibold">Approve tool: {props.block.name}</p>
          <p class="mt-0.5 text-xs opacity-80">{props.block.approval?.message ?? "The assistant wants to run this tool."}</p>
        </div>
        <Show
          when={pending()}
          fallback={<span class="text-xs font-medium opacity-80">{props.block.status === "rejected" ? "rejected" : "approved"}</span>}
        >
          <div class="flex shrink-0 flex-wrap gap-1">
            <button type="button" class="btn-input btn-input-sm" onClick={() => void actions.onApproval?.(request(), { approved: false })}>
              Reject
            </button>
            <button type="button" class="btn-ai btn-sm" onClick={() => void actions.onApproval?.(request(), { approved: true })}>
              Approve
            </button>
            <Show when={props.block.approval?.allowAlways}>
              <button
                type="button"
                class="btn-input btn-input-sm"
                onClick={() => void actions.onApproval?.(request(), { approved: true, remember: "always" })}
              >
                Always allow
              </button>
            </Show>
          </div>
        </Show>
      </div>
      <ChatUtilityDisclosure meta={{ icon: "ti ti-list-details", label: "Show details" }} class="mt-2">
        <pre class="max-h-40 overflow-auto rounded-md bg-white/55 p-2 text-[11px] text-primary dark:bg-black/20">
          {jsonPreview(props.block.args)}
        </pre>
      </ChatUtilityDisclosure>
    </div>
  );
}

function SurveyToolView(props: { turnId: string; block: ToolBlock }) {
  const actions = useAiMessageActions();
  const request = () => ({ turnId: props.turnId, callId: props.block.callId, name: props.block.name });
  const submittedResult = () =>
    props.block.status === "completed" && isRecord(props.block.result) && props.block.result.submitted === true ? props.block.result : null;
  return (
    <Switch fallback={<CloudSurveyBlock args={props.block.args} disabled />}>
      <Match when={props.block.status === "awaiting_client"}>
        <CloudSurveyBlock args={props.block.args} onSubmit={(result) => actions.onFrontendToolResult?.(request(), result)} />
      </Match>
      <Match when={submittedResult()}>{(result) => <CloudSurveyResultBlock args={props.block.args} result={result()} />}</Match>
    </Switch>
  );
}

function ToolBlockView(props: { turnId: string; block: ToolBlock }) {
  const status = () => props.block.status;
  return (
    <Switch
      fallback={
        <ToolResultDisclosure
          name={displayToolName(props.block.name)}
          toolName={props.block.name}
          args={props.block.args}
          result={props.block.result}
          isError={Boolean(props.block.isError)}
        />
      }
    >
      <Match when={status() === "awaiting_approval" || status() === "rejected"}>
        <ApprovalBlockView turnId={props.turnId} block={props.block} />
      </Match>
      <Match when={props.block.name === "bash"}>
        <BashToolBlock block={props.block} />
      </Match>
      <Match when={props.block.name === "present"}>
        <PresentToolBlock block={props.block} />
      </Match>
      <Match when={props.block.name === "web_search" && !props.block.isError}>
        <WebSearchToolBlock block={props.block} />
      </Match>
      <Match when={props.block.name === "web_extract" && !props.block.isError}>
        <WebExtractToolBlock block={props.block} />
      </Match>
      <Match when={isCardToolName(props.block.name)}>
        <CloudCardBlock args={props.block.args} />
      </Match>
      <Match when={isSurveyToolName(props.block.name)}>
        <SurveyToolView turnId={props.turnId} block={props.block} />
      </Match>
      <Match when={status() === "running" || status() === "awaiting_client"}>
        <ChatUtilityLine meta={{ icon: "ti ti-tool", label: displayToolName(props.block.name) }} trailing={<PulseDots />} />
      </Match>
    </Switch>
  );
}

/** Render one unified turn block. Shared by persisted assistant groups and the live turn. */
export function AiTurnBlockView(props: { block: AiTurnBlock; turnId: string; streaming?: boolean }) {
  // block.kind is immutable for a given block id, so this switch may run once.
  const block = props.block;
  switch (block.kind) {
    case "text":
      return <AssistantMarkdownBlock html={markdown.renderSync(block.text)} />;
    case "thinking":
      return <ThinkingBlockView text={block.text} streaming={props.streaming} />;
    case "tool":
      return <ToolBlockView turnId={props.turnId} block={block} />;
    case "compaction":
      return <CompactionBlockView block={block} />;
  }
}

export function AiTurnBlockList(props: { blocks: AiTurnBlock[]; turnId: string; streaming?: boolean }) {
  const visible = () => props.blocks.filter(isRenderableTurnBlock);
  return (
    <For each={visible()}>
      {(block, index) => (
        <AiTurnBlockView block={block} turnId={props.turnId} streaming={props.streaming && index() === visible().length - 1} />
      )}
    </For>
  );
}
