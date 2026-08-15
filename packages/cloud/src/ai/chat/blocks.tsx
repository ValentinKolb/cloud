import { mutation } from "@k2b/stdlib/solid";
import { Button, Chat, isStructuredDataValue, SplitButton, StructuredDataPreview } from "@k2b/ui";
import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { markdown } from "../../shared";
import type { AiTurnBlock } from "../protocol";
import { isRenderableTurnBlock } from "../protocol";
import { PresentToolBlock } from "./file-tools";
import { useAiChatActions } from "./message-actions";
import {
  aiToolIcon,
  displayToolName,
  formatToolDetailText,
  isCardToolName,
  isRecord,
  isSurveyToolName,
  jsonPreview,
  memoryToolPresentation,
  toolBlockSummary,
} from "./message-utils";
import { AssistantMarkdownBlock } from "./primitives";
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
          <Chat.Activity label="Thinking" icon="ti ti-sparkles" tone="ai" busy />
        </Show>
      }
    >
      <Chat.Activity label="Show reasoning" icon="ti ti-sparkles" tone="ai">
        <pre class="max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-100/70 p-2 text-[11px] leading-5 text-secondary [box-shadow:var(--ui-control-recess)] dark:bg-zinc-950/70">
          {props.text}
        </pre>
      </Chat.Activity>
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
    <Show when={status() !== "running"} fallback={<Chat.Activity label="Compacting context" icon="ti ti-brain" tone="ai" busy />}>
      <Chat.Activity label="Show compaction" description={description()} icon="ti ti-brain" tone={status() === "failed" ? "danger" : "ai"}>
        <div class="max-w-xl rounded-md bg-zinc-100/70 p-2 text-[11px] leading-5 text-secondary [box-shadow:var(--ui-control-recess)] dark:bg-zinc-950/70">
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
      </Chat.Activity>
    </Show>
  );
}

function ToolDetailSection(props: { title: string; children: JSX.Element }) {
  return (
    <div class="min-w-0">
      <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-dimmed">{props.title}</p>
      <pre class="max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-100 p-2 text-[11px] leading-4 text-primary [box-shadow:var(--ui-control-recess)] dark:bg-zinc-950/70">
        {props.children}
      </pre>
    </div>
  );
}

function ToolResultDisclosure(props: {
  name: string;
  toolName: string;
  args?: unknown;
  result: unknown;
  isError: boolean;
  icon?: string;
  accent?: string;
  labelOnError?: string;
  descriptionPrefix?: string;
}) {
  const summary = () => toolBlockSummary(props.result);
  const description = () =>
    [props.descriptionPrefix, props.isError ? "error" : undefined, summary() || undefined].filter(Boolean).join(" · ") || undefined;
  return (
    <Chat.Activity
      icon={props.icon ?? (props.isError ? "ti ti-alert-circle" : aiToolIcon(props.toolName))}
      label={props.isError ? (props.labelOnError ?? "Show tool error") : props.name}
      description={description()}
      tone={props.isError ? "danger" : "neutral"}
      accent={props.accent}
    >
      <div class="flex max-w-xl flex-col gap-2">
        <Show when={props.args !== undefined}>
          <ToolDetailSection title="Input">{formatToolDetailText(props.toolName, props.args) || jsonPreview(props.args)}</ToolDetailSection>
        </Show>
        <ToolDetailSection title="Result">{formatToolDetailText(props.toolName, props.result)}</ToolDetailSection>
      </div>
    </Chat.Activity>
  );
}

function ApprovalBlockView(props: { turnId: string; block: ToolBlock }) {
  const actions = useAiChatActions();
  const request = () => ({ turnId: props.turnId, callId: props.block.callId, name: props.block.name });
  const pending = () => props.block.status === "awaiting_approval";
  const actionDisabled = () => actions.actionDisabled?.() ?? false;
  const [submitted, setSubmitted] = createSignal(false);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const approval = mutation.create<void, { approved: boolean; remember?: "always" }>({
    mutation: async (input) => {
      if (!actions.onApproval) throw new Error("Approval is unavailable.");
      await actions.onApproval(request(), input);
    },
    onSuccess: () => setSubmitted(true),
  });
  const submit = (input: { approved: boolean; remember?: "always" }) => {
    if (!actionDisabled() && !approval.loading()) void approval.mutate(input);
  };
  const title = () => props.block.presentation?.title ?? displayToolName(props.block.name);
  const ownerName = () => props.block.presentation?.appName ?? "Assistant";
  const description = () => {
    const message = props.block.approval?.message?.trim();
    if (!message) return null;
    const duplicateTitle = props.block.presentation ? `${props.block.presentation.appName}: ${props.block.presentation.title}\n` : "";
    const withoutDuplicateTitle = message.startsWith(duplicateTitle) ? message.slice(duplicateTitle.length).trim() : message;
    if (/^Review the validated arguments below before running this action\.$/i.test(withoutDuplicateTitle)) return null;
    return withoutDuplicateTitle || null;
  };
  const reviewLines = () =>
    (description() ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = /^([^:]{1,40}):\s+(.+)$/.exec(line);
        return match ? { label: match[1], value: match[2] } : { value: line };
      });
  const detailData = () => (isStructuredDataValue(props.block.args) ? props.block.args : undefined);
  const appAccent = () => props.block.presentation?.appAccent;
  const detailsId = `approval-details-${props.block.callId}`;
  return (
    <div class="w-full">
      <section
        class={`w-full rounded-xl border p-4 text-sm text-primary ${appAccent() ? "app-accent-scope" : ""}`}
        style={{
          "--app-accent": appAccent(),
          "border-color": appAccent() ? "color-mix(in srgb, var(--app-accent) 42%, var(--k2b-border))" : "var(--k2b-ai-border)",
          background: appAccent()
            ? "color-mix(in srgb, var(--app-accent) 7%, var(--k2b-surface))"
            : "color-mix(in srgb, var(--k2b-ai-surface) 62%, var(--k2b-surface))",
        }}
        aria-label={`Approval required: ${title()}`}
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span
              class="inline-flex size-6 shrink-0 items-center justify-center text-lg leading-none"
              style={{ color: appAccent() ? "var(--ui-app-accent-text)" : "var(--k2b-ai-accent)" }}
              aria-hidden="true"
            >
              <i class={`${aiToolIcon(props.block.name, props.block.presentation?.appIcon)} leading-none`} />
            </span>
            <h3 class="min-w-0 text-sm font-semibold leading-5 text-primary">{ownerName()}</h3>
          </div>
          <Show
            when={pending()}
            fallback={
              <span class="text-xs font-medium text-secondary">
                {title()} · {props.block.status === "rejected" ? "Rejected" : "Approved"}
              </span>
            }
          >
            <Show when={actions.onApproval} fallback={<span class="text-xs font-medium text-secondary">Approval unavailable</span>}>
              <div class="shrink-0">
                <Show
                  when={!actionDisabled()}
                  fallback={
                    <span class="inline-flex items-center gap-1 text-xs font-medium text-secondary">
                      <i class="ti ti-player-stop" aria-hidden="true" />
                      Stopping response
                    </span>
                  }
                >
                  <Show
                    when={!approval.loading() && !submitted()}
                    fallback={
                      <span class="inline-flex items-center gap-1 text-xs font-medium text-secondary">
                        <i class={`ti ${submitted() ? "ti-check" : "ti-loader-2 animate-spin"}`} aria-hidden="true" />
                        {submitted() ? "Submitted" : "Submitting"}
                      </span>
                    }
                  >
                    <div class="flex flex-wrap gap-1">
                      <Button size="xs" variant="ghost" onClick={() => submit({ approved: false })}>
                        Reject
                      </Button>
                      <Show
                        when={props.block.approval?.allowAlways}
                        fallback={
                          <Button size="xs" variant="ai" onClick={() => submit({ approved: true })}>
                            {title()}
                          </Button>
                        }
                      >
                        <SplitButton
                          size="xs"
                          variant="ai"
                          onClick={() => submit({ approved: true })}
                          menuLabel={`More approval options for ${title()}`}
                          menuPosition="bottom-right"
                          items={[
                            {
                              label: "Always approve",
                              icon: "ti ti-shield-check",
                              action: () => submit({ approved: true, remember: "always" }),
                            },
                          ]}
                        >
                          {title()}
                        </SplitButton>
                      </Show>
                    </div>
                  </Show>
                </Show>
                <Show when={approval.error()}>
                  <p class="mt-1 text-xs text-red-700 dark:text-red-300">Could not submit. Try again.</p>
                </Show>
              </div>
            </Show>
          </Show>
        </div>
        <Show when={reviewLines().length > 0}>
          <div class="mt-3 flex flex-col gap-1 text-xs leading-5 text-secondary">
            <For each={reviewLines()}>
              {(line) => (
                <p class="whitespace-pre-wrap">
                  <Show when={line.label}>{(label) => <strong class="font-semibold text-primary">{label()}: </strong>}</Show>
                  {line.value}
                </p>
              )}
            </For>
          </div>
        </Show>
        <button
          type="button"
          class="mt-3 inline-flex min-h-6 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-medium text-secondary transition-colors hover:text-primary"
          aria-expanded={detailsOpen()}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          Details
          <i
            class={`ti ti-chevron-right text-xs leading-none transition-transform ${detailsOpen() ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
      </section>
      <Show when={detailsOpen()}>
        <div id={detailsId} class="mt-2 w-full" role="region" aria-label={`${title()} details`}>
          <Show
            when={detailData()}
            fallback={
              <pre class="max-h-40 overflow-auto rounded-md bg-white/55 p-2 text-[11px] text-primary dark:bg-black/20">
                {jsonPreview(props.block.args)}
              </pre>
            }
          >
            {(data) => <StructuredDataPreview data={data()} class="w-full" />}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function CapabilityToolView(props: { block: ToolBlock }) {
  const presentation = () => props.block.presentation!;
  const label = () => `${presentation().appName}: ${presentation().title}`;
  const kind = () => (presentation().capabilityKind === "query" ? "Query" : "Action");
  return (
    <Show
      when={props.block.status !== "running"}
      fallback={
        <Chat.Activity
          icon={aiToolIcon(props.block.name, presentation().appIcon)}
          label={label()}
          description={kind()}
          tone="ai"
          accent={presentation().appAccent}
          busy
        />
      }
    >
      <ToolResultDisclosure
        name={label()}
        labelOnError={label()}
        icon={aiToolIcon(props.block.name, presentation().appIcon)}
        accent={presentation().appAccent}
        descriptionPrefix={kind()}
        toolName={props.block.name}
        args={props.block.args}
        result={props.block.result}
        isError={Boolean(props.block.isError)}
      />
    </Show>
  );
}

function SurveyToolView(props: { turnId: string; block: ToolBlock }) {
  const actions = useAiChatActions();
  const request = () => ({ turnId: props.turnId, callId: props.block.callId, name: props.block.name });
  const submit = actions.onFrontendToolResult;
  const submittedResult = () =>
    props.block.status === "completed" && isRecord(props.block.result) && props.block.result.submitted === true ? props.block.result : null;
  return (
    <Switch fallback={<CloudSurveyBlock args={props.block.args} disabled />}>
      <Match when={props.block.status === "awaiting_client"}>
        <CloudSurveyBlock
          args={props.block.args}
          disabled={!submit || actions.actionDisabled?.()}
          disabledLabel={actions.actionDisabled?.() ? "Stopping response." : undefined}
          onSubmit={submit ? (result) => submit(request(), result) : undefined}
        />
      </Match>
      <Match when={submittedResult()}>{(result) => <CloudSurveyResultBlock args={props.block.args} result={result()} />}</Match>
    </Switch>
  );
}

function MemoryToolView(props: { block: ToolBlock }) {
  const presentation = () => memoryToolPresentation(props.block.args, props.block.result);
  return (
    <Show when={props.block.status !== "running"} fallback={<Chat.Activity label="Using memory" icon="ti ti-brain" tone="ai" busy />}>
      <Show
        when={presentation()}
        fallback={
          <ToolResultDisclosure
            name="Memory"
            toolName={props.block.name}
            args={props.block.args}
            result={props.block.result}
            isError={Boolean(props.block.isError)}
          />
        }
      >
        {(item) => (
          <Chat.Activity
            icon={`ti ${item().failed ? "ti-alert-circle" : "ti-brain"}`}
            label={item().label}
            description={item().description}
            tone={item().failed ? "danger" : "ai"}
          />
        )}
      </Show>
    </Show>
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
      <Match when={props.block.presentation?.kind === "capability"}>
        <CapabilityToolView block={props.block} />
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
      <Match when={props.block.name === "memory"}>
        <MemoryToolView block={props.block} />
      </Match>
      <Match when={isCardToolName(props.block.name)}>
        <CloudCardBlock args={props.block.args} />
      </Match>
      <Match when={isSurveyToolName(props.block.name)}>
        <SurveyToolView turnId={props.turnId} block={props.block} />
      </Match>
      <Match when={status() === "running" || status() === "awaiting_client"}>
        <Chat.Activity label={displayToolName(props.block.name)} icon={aiToolIcon(props.block.name)} busy />
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
    case "steer_message":
      return null;
    case "steer_applied":
      return <Chat.Activity label="Conversation steered" icon="ti ti-route" tone="ai" />;
    case "tool":
      return <ToolBlockView turnId={props.turnId} block={block} />;
    case "compaction":
      return <CompactionBlockView block={block} />;
  }
}

export function AiTurnBlockList(props: { blocks: AiTurnBlock[]; turnId: string; streaming?: boolean; compact?: boolean }) {
  const visible = () => props.blocks.filter(isRenderableTurnBlock);
  return (
    <div class={`flex flex-col ${props.compact ? "gap-1" : "gap-2"}`}>
      <For each={visible()}>
        {(block, index) => (
          <AiTurnBlockView block={block} turnId={props.turnId} streaming={props.streaming && index() === visible().length - 1} />
        )}
      </For>
    </div>
  );
}
