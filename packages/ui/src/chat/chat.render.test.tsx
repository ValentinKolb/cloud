import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-chat-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const {
  ChatActivity,
  ChatComposer,
  ChatContextUsage,
  ChatMessage,
  ChatTimeline,
  formatChatTokens,
} = await import("../index");

describe("@k2b/ui portable chat family", () => {
  test("renders controlled composition, commands, attachments, models, and runtime actions", () => {
    const html = renderToString(() =>
      createComponent(ChatComposer, {
        value: "/",
        onValueChange: () => undefined,
        onSend: () => undefined,
        onSteer: () => undefined,
        onStop: () => undefined,
        running: true,
        attachments: [
          { id: "brief", name: "brief.pdf", size: 12_000, kind: "file" },
        ],
        onAttachmentsChange: () => undefined,
        fileSelection: { onSelect: () => undefined },
        models: [{ id: "fast", label: "Fast model", description: "Low latency" }],
        selectedModelId: "fast",
        onModelChange: () => undefined,
        commands: [
          { name: "clear", description: "Clear the conversation", action: () => undefined },
        ],
        context: createComponent(ChatContextUsage, {
          usage: { input: 1_000, output: 200 },
          contextWindow: 8_000,
        }),
      }),
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("/clear");
    expect(html).toContain("brief.pdf");
    expect(html).toContain("12 KB");
    expect(html).toContain("Fast model");
    expect(html).toContain('aria-label="Stop"');
    expect(html).toContain('aria-label="Steer response"');
    expect(html).toContain("15%");
    expect(html).toContain('aria-label="Attach files"');
    expect(html).toContain('aria-label="Remove brief.pdf"');
    expect(html).toContain('role="option"');
  });

  test("exposes the open command list as a combobox popup owned by the textarea", () => {
    const commands = [
      { name: "clear", description: "Clear the conversation", action: () => undefined },
    ];
    const withCommands = renderToString(() =>
      createComponent(ChatComposer, {
        value: "/cl",
        onValueChange: () => undefined,
        onSend: () => undefined,
        commands,
      }),
    );
    const withoutCommands = renderToString(() =>
      createComponent(ChatComposer, {
        value: "hello",
        onValueChange: () => undefined,
        onSend: () => undefined,
        commands,
      }),
    );

    expect(withCommands).toContain('role="combobox"');
    expect(withCommands).toContain('aria-autocomplete="list"');
    expect(withCommands).toContain('aria-expanded="true"');
    expect(withCommands).toMatch(/aria-controls="k2b-chat-commands-[^"]+"/);
    expect(withCommands).toMatch(/aria-activedescendant="k2b-chat-commands-[^"]+-0"/);
    expect(withCommands).toContain('tabindex="-1"');

    expect(withoutCommands).not.toContain('role="listbox"');
    expect(withoutCommands).not.toContain('role="combobox"');
    expect(withoutCommands).not.toContain("aria-expanded");
    expect(withoutCommands).not.toContain("aria-activedescendant");
  });

  test("labels the composer and disables submission without a draft or attachments", () => {
    const html = renderToString(() =>
      createComponent(ChatComposer, {
        value: "",
        onValueChange: () => undefined,
        onSend: () => undefined,
        label: "Support composer",
        inputLabel: "Support message",
        error: "Model unavailable",
      }),
    );

    expect(html).toContain('aria-label="Support composer"');
    expect(html).toContain('aria-label="Support message"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Model unavailable");
    expect(html).toMatch(/class="k2b-chat-composer__send"[^>]*disabled/);
  });

  test("renders semantic messages and expandable activity", () => {
    const message = renderToString(() =>
      createComponent(ChatMessage, {
        messageRole: "assistant",
        status: "streaming",
        createdAt: "2026-07-28T12:00:00.000Z",
        content: "Working on it",
        actions: "Retry",
      }),
    );
    const activity = renderToString(() =>
      createComponent(ChatActivity, {
        label: "Looked up documentation",
        description: "2 sources",
        defaultOpen: true,
        children: "Source details",
      }),
    );

    expect(message).toContain('data-role="assistant"');
    expect(message).toContain('aria-busy="true"');
    expect(message).toContain("Generating");
    expect(message).toContain("Retry");
    expect(activity).toContain("<details");
    expect(activity).toContain("open");
    expect(activity).toContain("Source details");
  });

  test("renders a generic timeline without application protocols", () => {
    const html = renderToString(() =>
      createComponent(ChatTimeline, {
        label: "Support conversation",
        items: [
          { kind: "message", id: "one", role: "user", content: "Hello" },
          {
            kind: "activity",
            id: "two",
            label: "Searching",
            description: "Documentation",
            tone: "ai",
          },
          { kind: "message", id: "three", role: "assistant", content: "How can I help?" },
        ],
      }),
    );

    expect(html).toContain('aria-label="Support conversation"');
    expect(html).toContain('role="log"');
    expect(html).toContain("Hello");
    expect(html).toContain("Searching");
    expect(html).toContain("How can I help?");
    expect(html).not.toContain("AiStoredMessage");
  });

  test("renders application navigation outside the conversation live region", () => {
    const html = renderToString(() =>
      createComponent(ChatTimeline, {
        items: [{ kind: "message", id: "one", role: "user", content: "Hello" }],
        navigation: "Turn navigation",
      }),
    );

    expect(html).toContain("k2b-chat-timeline__navigation");
    expect(html.indexOf("Turn navigation")).toBeLessThan(html.indexOf('role="log"'));
  });

  test("renders the empty state and formats compact token values", () => {
    const html = renderToString(() =>
      createComponent(ChatTimeline, {
        items: [],
        emptyTitle: "Ask the workspace",
        emptyDescription: "Messages stay in this project.",
      }),
    );

    expect(html).toContain("Ask the workspace");
    expect(html).toContain("Messages stay in this project.");
    expect(formatChatTokens(1_250)).toBe("1.3k");
    expect(formatChatTokens(2_500_000)).toBe("2.5M");
  });

  test("keeps the context trigger honest when no usage was reported", () => {
    const withoutUsage = renderToString(() =>
      createComponent(ChatContextUsage, { contextWindow: 128_000 }),
    );
    const withUsage = renderToString(() =>
      createComponent(ChatContextUsage, {
        usage: { input: 120_000, output: 4_000 },
        contextWindow: 128_000,
      }),
    );

    expect(withoutUsage).toContain("Context usage unavailable, 128,000 token context window");
    expect(withoutUsage).toContain("<span>Context</span>");
    expect(withoutUsage).not.toContain("<small>");
    expect(withoutUsage).not.toContain('data-warning="true"');
    expect(withUsage).toContain('data-warning="true"');
    expect(withUsage).toContain("124,000 tokens used, 97% of the context window");
  });

  test("offers a keyboard reachable history control only while more history exists", () => {
    const items = [
      { kind: "message" as const, id: "one", role: "user" as const, content: "Hello" },
    ];
    const withHistory = renderToString(() =>
      createComponent(ChatTimeline, {
        items,
        hasMore: true,
        onLoadOlder: () => undefined,
      }),
    );
    const loadingHistory = renderToString(() =>
      createComponent(ChatTimeline, {
        items,
        hasMore: true,
        loadingOlder: true,
        onLoadOlder: () => undefined,
      }),
    );
    const exhausted = renderToString(() =>
      createComponent(ChatTimeline, { items, hasMore: false, onLoadOlder: () => undefined }),
    );
    const uncontrolled = renderToString(() => createComponent(ChatTimeline, { items }));

    expect(withHistory).toContain("Load older messages");
    expect(withHistory).toContain('class="k2b-chat-timeline__viewport"');
    expect(withHistory).toContain('role="region"');
    expect(withHistory).toContain('aria-label="Conversation messages"');
    expect(withHistory).toContain('tabindex="0"');
    expect(loadingHistory).toContain("Loading older messages");
    expect(loadingHistory).not.toContain("Load older messages");
    expect(exhausted).not.toContain("Load older messages");
    expect(uncontrolled).not.toContain("Load older messages");
    expect(uncontrolled).not.toContain("k2b-chat-timeline__history");
  });

  test("keeps history controls out of the conversation live region announcements", () => {
    const html = renderToString(() =>
      createComponent(ChatTimeline, {
        items: [{ kind: "message" as const, id: "one", role: "user" as const, content: "Hi" }],
        hasMore: true,
        onLoadOlder: () => undefined,
      }),
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-live="off"');
    expect(html.indexOf('aria-live="polite"')).toBeLessThan(html.indexOf('aria-live="off"'));
  });

  test("keeps the chat family free of application protocol vocabulary", async () => {
    const sources = ["ChatComposer.tsx", "ChatPrimitives.tsx", "ChatTimeline.tsx", "chat-behavior.ts", "index.ts"];
    const forbidden =
      /\b(session|approval|permission|persistence|persisted|AiStoredMessage|AiActiveTurn|useNavigate)\b/i;

    for (const file of sources) {
      const source = await Bun.file(resolve(import.meta.dir, file)).text();
      expect(source, file).not.toMatch(forbidden);
      expect(source, file).not.toMatch(/from\s+"(?:@valentinkolb\/cloud|.*\/cloud\/)/);
      for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
        expect(match[1], `${file} imports ${match[1]}`).not.toContain("../../");
      }
    }
  });

  test("does not retain the superseded experimental ai surface", async () => {
    const manifest = await Bun.file(resolve(import.meta.dir, "../../package.json")).json();
    const barrel = await Bun.file(resolve(import.meta.dir, "../index.ts")).text();
    const aiRoot = resolve(import.meta.dir, "../ai");

    expect(!existsSync(aiRoot) || readdirSync(aiRoot).length === 0).toBe(true);
    expect(manifest.files).not.toContain("!src/ai/**");
    expect(barrel).not.toContain('"./ai"');
  });

  test("focuses the composer as one AI-themed surface", () => {
    const css = readFileSync(resolve(import.meta.dir, "../styles/index.css"), "utf8");

    expect(css).toContain("--k2b-ai-accent:");
    expect(css).toContain(".k2b-ui .k2b-chat-composer:focus-within");
    expect(css).toContain("border-color: var(--k2b-ai-border);");
    expect(css).toContain("box-shadow: none;");
    expect(css).not.toContain("--k2b-ai-focus-ring");
    expect(css).not.toContain(".k2b-ui .k2b-chat-composer textarea:focus-visible");
  });
});
