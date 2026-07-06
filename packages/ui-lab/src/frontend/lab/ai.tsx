import type { AiPublicModelProfile, AiStoredMessage, AiUiBlock } from "@valentinkolb/cloud/ai";
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
  content: [{ type: "text" as const, text: "Activation is improving. I need one prioritization signal before proposing the next iteration." }],
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
    contextWindow: 8192,
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
      toolCallCount: 1,
      toolErrorCount: 0,
      toolIssueCount: 0,
      toolMalformedCount: 0,
      toolCancelledCount: 0,
      toolIssues: [],
      assistantMessageCount: 2,
    },
    loopDoneReason: "stop",
    createdAt: now,
  },
];

export const AiChatBlocksDemo = () => {
  const [submitted, setSubmitted] = createSignal(false);
  const blocks = (): AiUiBlock[] =>
    submitted()
      ? []
      : [
          {
            id: "survey",
            type: "frontend_tool",
            status: "pending",
            request: {
              type: "frontend_tool",
              conversationId: "ui-lab",
              turnId: "turn-1",
              callId: "survey-1",
              name: "survey",
              mode: "client_interaction",
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
            },
          },
        ];

  return (
    <DemoCard
      id="ai-chat-blocks"
      chip={{ kind: "component", name: "AiMessageList", from: FROM_AI_UI }}
      description="Assistant and app-specific chats use the same block renderer for text, thinking, default cards, and interactive frontend tools."
      code={`<AiMessageList
  messages={() => messages}
  assistantBlocks={() => activeBlocks}
  onFrontendToolResult={(request, result) => continueTurn(request, result)}
/>`}
    >
      <div class="h-[34rem] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <AiMessageList
          messages={() => demoMessages}
          assistantBlocks={blocks}
          streaming={() => !submitted()}
          onRetryMessage={() => undefined}
          onFrontendToolResult={() => {
            setSubmitted(true);
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
  models={() => models}
  selectedModelId={selectedModelId}
  onModelChange={setSelectedModelId}
  onNewConversation={createConversation}
  onSend={sendMessage}
/>`}
    >
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <AiComposer
          models={() => demoModels}
          selectedModelId={selectedModelId}
          onModelChange={setSelectedModelId}
          onNewConversation={() => undefined}
          disabled={() => false}
          running={() => false}
          usage={() => ({ input: 290, output: 129, total: 419 })}
          slashCommands={() => [
            {
              name: "summarize",
              description: "Prepare a summary request",
              icon: "ti ti-list-details",
              action: ({ setDraft }) => setDraft("Summarize this:\n"),
            },
          ]}
          onSend={() => true}
          onStop={() => undefined}
        />
      </div>
    </DemoCard>
  );
};
