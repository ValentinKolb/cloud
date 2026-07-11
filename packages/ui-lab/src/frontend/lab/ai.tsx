import type { AiPublicModelProfile, AiStoredMessage, AiTurnBlock } from "@valentinkolb/cloud/ai";
import type { AiActiveTurn } from "@valentinkolb/cloud/ai/solid";
import { AiComposer, AiMessageList } from "@valentinkolb/cloud/ai/ui";
import { createSignal } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_AI_UI = "@valentinkolb/cloud/ai/ui";

const now = new Date().toISOString();
const cardArgs = {
  title: "Activation",
  value: "71%",
  caption: "Example of the simplified Cloud highlight-card tool.",
  tone: "teal",
  trendValue: "+13%",
  trendLabel: "vs last cohort",
  trendDirection: "up",
};
const cardCallMessage = {
  role: "assistant" as const,
  content: [
    {
      type: "tool_call" as const,
      id: "card-1",
      name: "card",
      args: cardArgs,
    },
  ],
};
const finalAnswerMessage = {
  role: "assistant" as const,
  content: [
    { type: "text" as const, text: "Activation is improving. I need one prioritization signal before proposing the next iteration." },
  ],
};
const finalAnswerUsage = { input: 380, output: 64, total: 444 };

const demoModels: AiPublicModelProfile[] = [
  {
    id: "fast",
    label: "vLLM Qwen 3.6",
    provider: "vllm",
    model: "qwen3.6",
    capabilities: ["streaming", "tools"],
    dataBoundary: "private",
    contextWindow: 262000,
  },
  {
    id: "vision",
    label: "OpenRouter Vision",
    provider: "openrouter",
    model: "openai/gpt-4.1-mini",
    capabilities: ["streaming", "tools", "vision"],
    dataBoundary: "hosted",
    contextWindow: 128000,
  },
];

const demoMessages: AiStoredMessage[] = [
  {
    id: "ui-lab-user",
    conversationId: "ui-lab",
    seq: 1,
    kind: "message",
    message: { role: "user", content: [{ type: "text", text: "Can you show the onboarding numbers and ask what to prioritize?" }] },
    modelProfileId: null,
    providerModel: null,
    usage: null,
    stopReason: null,
    loopId: null,
    loopAggregate: null,
    loopDoneReason: null,
    compactedAt: null,
    meta: null,
    createdAt: now,
  },
  {
    id: "ui-lab-card-call",
    conversationId: "ui-lab",
    seq: 2,
    kind: "message",
    message: cardCallMessage,
    modelProfileId: "demo",
    providerModel: "demo/model",
    usage: null,
    stopReason: "tool_use",
    loopId: "ui-lab-loop",
    loopAggregate: null,
    loopDoneReason: null,
    compactedAt: null,
    meta: null,
    createdAt: now,
  },
  {
    id: "ui-lab-answer",
    conversationId: "ui-lab",
    seq: 3,
    kind: "message",
    message: finalAnswerMessage,
    modelProfileId: "demo",
    providerModel: "demo/model",
    usage: finalAnswerUsage,
    stopReason: "stop",
    loopId: "ui-lab-loop",
    loopAggregate: {
      turns: [
        {
          message: cardCallMessage,
          stopReason: "tool_use",
          toolCalls: [{ callId: "card-1", name: "card", args: cardArgs, result: { displayed: true } }],
        },
        {
          message: finalAnswerMessage,
          usage: finalAnswerUsage,
          stopReason: "stop",
          toolCalls: [],
        },
      ],
      usage: finalAnswerUsage,
      issueCount: 0,
      issues: [],
      toolCallCount: 1,
      toolErrorCount: 0,
      toolIssueCount: 0,
      toolMalformedCount: 0,
      toolCancelledCount: 0,
      toolIssues: [],
      assistantMessageCount: 2,
    },
    loopDoneReason: "stop",
    compactedAt: null,
    meta: null,
    createdAt: now,
  },
];

export const AiChatBlocksDemo = () => {
  const [submitted, setSubmitted] = createSignal(false);
  const surveyBlock: AiTurnBlock = {
    id: "tool-survey-1",
    kind: "tool",
    callId: "survey-1",
    name: "survey",
    status: "awaiting_client",
    frontendMode: "client_interaction",
    args: {
      title: "Prioritize next step",
      description: "Interactive frontend tools can collect structured input directly in chat.",
      submitLabel: "Continue",
      questions: [
        {
          type: "single",
          id: "priority",
          label: "Which path should the assistant optimize for?",
          required: true,
          options: [
            { value: "quality", label: "Higher quality" },
            { value: "speed", label: "Faster flow" },
            { value: "clarity", label: "Clearer copy" },
          ],
        },
      ],
    },
  };
  const activeTurn = (): AiActiveTurn | null =>
    submitted()
      ? null
      : { turnId: "turn-1", attempt: 1, seq: 1, status: "waiting_for_action", modelProfileId: "demo", blocks: [surveyBlock] };

  return (
    <DemoCard
      id="ai-chat-blocks"
      chip={{ kind: "component", name: "AiMessageList", from: FROM_AI_UI }}
      description="Assistant and app-specific chats use the same block renderer for text, thinking, default cards, and interactive frontend tools."
      code={`<AiMessageList
  session={{ messages: () => messages, activeTurn: () => activeTurn }}
  actions={{ onFrontendToolResult: (request, result) => continueTurn(request, result) }}
/>`}
    >
      <div class="h-[34rem] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <AiMessageList
          session={{
            messages: () => demoMessages,
            activeTurn,
          }}
          actions={{
            onRetryMessage: () => undefined,
            onFrontendToolResult: () => {
              setSubmitted(true);
            },
          }}
        />
      </div>
    </DemoCard>
  );
};

export const AiComposerDemo = () => {
  const [selectedModelId, setSelectedModelId] = createSignal(demoModels[0]!.id);
  return (
    <DemoCard
      id="ai-composer"
      chip={{ kind: "component", name: "AiComposer", from: FROM_AI_UI }}
      description="Minimal Assistant composer with text model dropdown, action menu, in-field attachment previews, context indicator, and borderless send action."
      code={`<AiComposer
  models={{ profiles: () => models, selectedId: selectedModelId, onSelect: setSelectedModelId }}
  state={{ disabled: () => false, running: () => false }}
  actions={{ onNewConversation: createConversation, send: sendMessage, steer: steerMessage, stop }}
/>`}
    >
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <AiComposer
          models={{
            profiles: () => demoModels,
            selectedId: selectedModelId,
            onSelect: setSelectedModelId,
          }}
          state={{
            disabled: () => false,
            running: () => false,
            usage: () => ({ input: 15_876, output: 32, total: 15_908 }),
            loopUsage: () => ({ input: 69_944, output: 819, total: 70_763 }),
          }}
          actions={{
            onNewConversation: () => undefined,
            slashCommands: () => [
              {
                name: "summarize",
                description: "Prepare a summary request",
                icon: "ti ti-list-details",
                action: ({ setDraft }) => setDraft("Summarize this:\n"),
              },
            ],
            send: () => true,
            steer: () => true,
            stop: () => undefined,
          }}
        />
      </div>
    </DemoCard>
  );
};
