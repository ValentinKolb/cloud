import {
  ChatComposer,
  ChatContextUsage,
  ChatTimeline,
  CodeDisplay,
  type ChatTimelineItem,
} from "@k2b/ui";
import { createSignal } from "solid-js";
import { DemoCard } from "../DemoCard";
import { DemoGrid, type DemoSection } from "./types";

const initialItems = (): ChatTimelineItem[] => [
  {
    kind: "message",
    id: "question",
    role: "user",
    content: "Which component should own the empty state?",
    timeLabel: "09:41",
  },
  {
    kind: "activity",
    id: "search",
    label: "Searching component exports",
    description: "search_components · @k2b/ui",
    tone: "ai",
    icon: "ti ti-search",
    trailing: <i class="ti ti-loader-2 k2b-spin" aria-label="Running" />,
  },
  {
    kind: "activity",
    id: "inspection",
    label: "Read component source",
    description: "read_file · 3 files · 18 ms",
    tone: "success",
    icon: "ti ti-file-search",
    defaultOpen: true,
    content: (
      <CodeDisplay
        title="Tool result"
        language="text"
        lineNumbers={false}
        code={`Placeholder
  state="empty"
  title="No records"
  description="Create the first record."`}
      />
    ),
  },
  {
    kind: "activity",
    id: "failed-tool",
    label: "Could not read release notes",
    description: "fetch_url · Request returned 404",
    tone: "danger",
    icon: "ti ti-world-x",
    content: <p>The application can render recovery actions or the raw tool error here.</p>,
  },
  {
    kind: "message",
    id: "answer",
    role: "assistant",
    content: "Keep the state in the application and render it with the portable Placeholder.",
    timeLabel: "09:42",
  },
];

const ChatDemo = () => {
  const [draft, setDraft] = createSignal("");
  const [messages, setMessages] = createSignal(initialItems());
  const [model, setModel] = createSignal("fast");
  return (
    <DemoCard
      id="chat"
      chip={[
        { kind: "component", name: "ChatTimeline", from: "@k2b/ui" },
        { kind: "component", name: "ChatComposer", from: "@k2b/ui" },
      ]}
      description="Portable, controlled chat presentation with generic tool activity. The host owns protocol, persistence, uploads, and model execution."
      code={`<ChatTimeline items={items()} />
<ChatComposer
  value={draft()}
  onValueChange={setDraft}
  onSend={({ text }) => sendMessage(text)}
  context={<ChatContextUsage usage={usage()} contextWindow={128_000} />}
/>`}
    >
      <div class="ui-chat-demo">
        <ChatTimeline items={messages()} conversationKey="fibel-demo" />
        <ChatComposer
          value={draft()}
          onValueChange={setDraft}
          placeholder="Write a message…"
          models={[
            { id: "fast", label: "Fast" },
            { id: "deep", label: "Deep", description: "More reasoning" },
          ]}
          selectedModelId={model()}
          onModelChange={setModel}
          fileSelection={{ onSelect: () => undefined }}
          commands={[
            {
              name: "summarize",
              description: "Summarize the current conversation",
              action: ({ setValue }) => setValue("Summarize this conversation"),
            },
          ]}
          context={
            <ChatContextUsage
              modelLabel={model() === "fast" ? "Fast" : "Deep"}
              usage={{ input: 3_040, output: 180, total: 3_220 }}
              contextWindow={128_000}
            />
          }
          onSend={({ text }) => {
            if (!text) return false;
            setMessages((current) => [
              ...current,
              {
                kind: "message",
                id: `demo-${current.length}`,
                role: "user",
                content: <p>{text}</p>,
                timeLabel: "now",
              },
            ]);
          }}
        />
      </div>
    </DemoCard>
  );
};

const ContextUsageDemo = () => (
  <DemoCard
    id="context-usage"
    chip={{ kind: "component", name: "ChatContextUsage", from: "@k2b/ui" }}
    description="A compact button with an accessible summary and detailed token disclosure in its tooltip."
    code={`<ChatContextUsage
  modelLabel="Deep"
  usage={{ input: 18_420, output: 2_140, total: 20_560 }}
  contextWindow={128_000}
/>`}
  >
    <ChatContextUsage
      modelLabel="Deep"
      usage={{ input: 18_420, output: 2_140, total: 20_560 }}
      loopUsage={{ total: 31_800 }}
      contextWindow={128_000}
    />
  </DemoCard>
);

const demos: DemoSection = {
  chat: () => (
    <DemoGrid columns="one">
      <ChatDemo />
    </DemoGrid>
  ),
  "context-usage": () => (
    <DemoGrid columns="one">
      <ContextUsageDemo />
    </DemoGrid>
  ),
};

export default demos;
