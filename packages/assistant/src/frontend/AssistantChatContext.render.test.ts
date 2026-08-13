import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import type { AiConversationSource } from "@valentinkolb/cloud/ai";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { AssistantChatContextSnapshot } from "../chat-context";
import { assistantChatContextFor, splitAssistantConversationSources } from "./assistant-context";

const root = mkdtempSync(resolve(tmpdir(), "assistant-chat-context-"));
const serovalLink = resolve(import.meta.dir, "../../node_modules/seroval");
const createdSerovalLink = !existsSync(serovalLink);
if (createdSerovalLink) symlinkSync(resolve(import.meta.dir, "../../../cloud/node_modules/seroval"), serovalLink, "dir");
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  if (createdSerovalLink) unlinkSync(serovalLink);
});

const { assistantChatContextHasContent, AssistantChatContextContent, AssistantChatContextPanel } = await import("./AssistantChatContext");
const { AssistantChatContextSurface } = await import("./AssistantChatContextSurfaces");
const { AssistantLiveProvider, createAssistantLiveInvalidationHub } = await import("./assistant-live");

const source = (kind: AiConversationSource["kind"], key: string): AiConversationSource => ({
  kind,
  key,
  title: key,
  preview: null,
  icon: "ti ti-link",
  href: null,
  path: kind === "file" ? `/${key}` : null,
  mediaType: null,
  size: null,
  ref: kind === "resource" ? { type: "notebook", id: key } : null,
  occurrences: 1,
  firstSeenAt: "2026-08-12T08:00:00.000Z",
  lastSeenAt: "2026-08-12T08:00:00.000Z",
  sourceTurnId: null,
  sourceCallId: null,
});

test("Assistant chat context never reuses the previous chat snapshot while a new chat loads", () => {
  const stale = { chatId: "old-chat" } as AssistantChatContextSnapshot;
  expect(assistantChatContextFor("new-chat", stale)).toBeNull();
  expect(assistantChatContextFor("old-chat", stale)).toBe(stale);
});

describe("Assistant chat context", () => {
  test("keeps used sources, Cloud references, and files in distinct user-facing groups", () => {
    const split = splitAssistantConversationSources([
      source("web", "docs"),
      source("activity", "search"),
      source("resource", "nb1234"),
      source("file", "brief.pdf"),
    ]);

    expect(split.sources.map((item) => item.key)).toEqual(["docs", "search"]);
    expect(split.references.map((item) => item.key)).toEqual(["nb1234"]);
  });

  test("renders the compact context only at the shared laptop breakpoint", () => {
    const html = renderToString(() => createComponent(AssistantChatContextSurface, { children: "Loading context" }));

    expect(html).toContain('data-assistant-context="compact"');
    expect(html).toContain('class="k2b-paper');
    expect(html).toContain('role="complementary"');
    expect(html).toContain("hidden");
    expect(html).toContain("lg:flex");
    expect(html).toContain("shrink-0");
    expect(html).not.toContain("absolute");
    expect(html).toContain('aria-label="Chat context"');
    expect(html).not.toContain("ti-adjustments-horizontal");
    expect(html).not.toContain("<h2");
    expect(html).toContain("Loading context");
  });

  test("omits the compact Paper after a successfully loaded empty context", () => {
    const live = createAssistantLiveInvalidationHub({ onApplied: () => undefined });
    const renderPanel = (initial: AssistantChatContextSnapshot) =>
      renderToString(() =>
        createComponent(AssistantLiveProvider, {
          value: live,
          get children() {
            return createComponent(AssistantChatContextPanel, {
              chatId: initial.chatId,
              initial,
            });
          },
        }),
      );

    const empty = { chatId: "cHt234", sources: [], files: [], tasks: [] } satisfies AssistantChatContextSnapshot;
    const populated = { ...empty, sources: [source("web", "docs")] } satisfies AssistantChatContextSnapshot;

    expect(assistantChatContextHasContent(empty)).toBeFalse();
    expect(assistantChatContextHasContent({ ...empty, sources: [source("file", "stale.pdf")] })).toBeFalse();
    expect(renderPanel(empty)).not.toContain('data-assistant-context="compact"');
    expect(assistantChatContextHasContent(populated)).toBeTrue();
    expect(renderPanel(populated)).toContain('data-assistant-context="compact"');
    live.dispose();
  });

  test("keeps the compact context title-free with right-aligned counts and no Chat ID", () => {
    const live = createAssistantLiveInvalidationHub({ onApplied: () => undefined });
    const html = renderToString(() =>
      createComponent(AssistantLiveProvider, {
        value: live,
        get children() {
          return createComponent(AssistantChatContextContent, {
            chatId: "cHt234",
            initial: { chatId: "cHt234", sources: [], files: [], tasks: [] },
          });
        },
      }),
    );
    live.dispose();

    expect(html).toContain("Sources");
    expect(html).toContain("References");
    expect(html).toContain("Images");
    expect(html).toContain("tabular-nums");
    expect(html).toContain("text-right");
    expect(html).not.toContain("Chat ID");
    expect(html).not.toContain(">Chat context<");
  });

  test("uses direct context viewers instead of an intermediate DetailPanel", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "AssistantChatContext.tsx")).text();
    expect(source).toContain("openAssistantContextFiles");
    expect(source).toContain("loadAssistantContextImages");
    expect(source).toContain("openAssistantKnowledgeSearch");
    expect(source).not.toContain("AssistantChatDetailPanel");
    expect(source).not.toContain("onViewDetail");
  });

  test("uses the shared compact action rows and keeps Project editing out of chats", async () => {
    const [context, shared] = await Promise.all([
      Bun.file(resolve(import.meta.dir, "AssistantChatContext.tsx")).text(),
      Bun.file(resolve(import.meta.dir, "AssistantContextContent.tsx")).text(),
    ]);
    expect(context).toContain('title="View project"');
    expect(context).not.toContain("openAssistantProjectSettingsDialog");
    expect(shared).toContain("<DetailPanel.Action");
  });
});
