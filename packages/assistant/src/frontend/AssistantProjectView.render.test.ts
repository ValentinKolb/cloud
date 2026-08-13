import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import type { AiConversation, AiConversationPage, AiProject } from "@valentinkolb/cloud/ai";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "assistant-project-view-"));
const serovalLink = resolve(import.meta.dir, "../../node_modules/seroval");
const createdSerovalLink = !existsSync(serovalLink);
if (createdSerovalLink) symlinkSync(resolve(import.meta.dir, "../../../cloud/node_modules/seroval"), serovalLink, "dir");
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  if (createdSerovalLink) unlinkSync(serovalLink);
});

const [{ default: AssistantProjectView }, { AssistantLiveProvider, createAssistantLiveInvalidationHub }] = await Promise.all([
  import("./AssistantProjectView"),
  import("./assistant-live"),
]);

const project = {
  id: "project123",
  shortId: "project123",
  appId: "assistant",
  name: "IT support",
  description: "",
  icon: "ti ti-folders",
  instructions: "Answer from the supplied runbooks.",
  defaultModelProfileId: null,
  permission: "admin",
  revision: 1,
  createdAt: "2026-08-12T08:00:00.000Z",
  updatedAt: "2026-08-12T08:00:00.000Z",
} satisfies AiProject;

const chat = {
  id: "chat123",
  shortId: "chat123",
  title: "Printer issue",
  description: "",
  projectId: project.id,
  updatedAt: "2026-08-12T09:00:00.000Z",
} as AiConversation;

const page = {
  items: [chat],
  page: 1,
  perPage: 20,
  total: 1,
  hasNext: false,
} as AiConversationPage;

describe("Assistant Project view", () => {
  test("places compact recent chats above the bottom composer and renders a quiet context rail", () => {
    const live = createAssistantLiveInvalidationHub({ onApplied: () => undefined });
    const html = renderToString(() =>
      createComponent(AssistantLiveProvider, {
        value: live,
        get children() {
          return createComponent(AssistantProjectView, {
            project,
            initialQuery: "",
            initialPage: page,
            initialContext: { projectId: project.id, knowledge: [], files: [], references: [] },
            onOpenConversation: async () => true,
            get composer() {
              return "Standard composer";
            },
          });
        },
      }),
    );
    live.dispose();

    expect(html).toContain("IT support");
    expect(html).toContain("Standard composer");
    expect(html).toContain('data-scroll-preserve="assistant-project-chats"');
    expect(html).toContain("Printer issue");
    expect(html.indexOf("Printer issue")).toBeLessThan(html.indexOf("Standard composer"));
    expect(html).not.toContain("k2b-paper");
    expect(html).not.toContain("divide-y");
    expect(html).toContain("Project context");
    expect(html).toContain("View project");
    expect(html).toContain("IT support");
    expect(html).toContain("text-[var(--ui-app-accent-text)]");
    expect(html).not.toContain(">Project instructions</h2>");
    expect(html).toContain("k2b-detail-panel__action");
    expect(html).toContain("Project knowledge");
    expect(html).toContain("Images");
    expect(html).toContain("References");
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Project settings"');
    expect(html).toContain('aria-label="Add Project knowledge"');
    expect(html).toContain('aria-label="Add reference"');
    expect(html).toContain("Add files");
    expect(html).not.toContain("admin access");
  });

  test("keeps Project context management out of a read-only workspace", () => {
    const live = createAssistantLiveInvalidationHub({ onApplied: () => undefined });
    const html = renderToString(() =>
      createComponent(AssistantLiveProvider, {
        value: live,
        get children() {
          return createComponent(AssistantProjectView, {
            project: { ...project, permission: "read" },
            initialQuery: "",
            initialPage: page,
            initialContext: { projectId: project.id, knowledge: [], files: [], references: [] },
            onOpenConversation: async () => true,
            get composer() {
              return "Standard composer";
            },
          });
        },
      }),
    );
    live.dispose();

    expect(html).not.toContain('aria-label="Project settings"');
    expect(html).not.toContain('aria-label="Add Project knowledge"');
    expect(html).not.toContain('aria-label="Add images"');
    expect(html).not.toContain('aria-label="Add files"');
    expect(html).not.toContain('aria-label="Add reference"');
  });
});
