import type { AiPublicModelProfile, AiStoredMessage, AiUiBlock } from "@valentinkolb/cloud/ai";
import { AiComposer, AiMessageList } from "@valentinkolb/cloud/ai/ui";
import { createSignal } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_AI_UI = "@valentinkolb/cloud/ai/ui";

const now = new Date().toISOString();

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
    createdAt: now,
  },
  {
    id: "ui-lab-card-call",
    conversationId: "ui-lab",
    seq: 2,
    kind: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "card-1",
          name: "card",
          args: {
            kind: "chart",
            title: "Activation by cohort",
            caption: "Example of the default Cloud card tool.",
            tone: "teal",
            data: [
              { label: "Week 1", value: 42 },
              { label: "Week 2", value: 58 },
              { label: "Week 3", value: 71 },
            ],
          },
        },
      ],
    },
    modelProfileId: "demo",
    providerModel: "demo/model",
    usage: null,
    stopReason: "tool_use",
    createdAt: now,
  },
  {
    id: "ui-lab-answer",
    conversationId: "ui-lab",
    seq: 3,
    kind: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Activation is improving. I need one prioritization signal before proposing the next iteration." }],
    },
    modelProfileId: "demo",
    providerModel: "demo/model",
    usage: { input: 380, output: 64, total: 444 },
    stopReason: "stop",
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
