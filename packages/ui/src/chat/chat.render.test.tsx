import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
  });

  test("renders semantic messages and expandable activity", () => {
    const message = renderToString(() =>
      createComponent(ChatMessage, {
        role: "assistant",
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
});
