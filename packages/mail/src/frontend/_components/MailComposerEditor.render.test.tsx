import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import type { PanesValue } from "@k2b/ui";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(join(tmpdir(), "mail-composer-editor-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: MailComposerEditor } = await import("./MailComposerEditor.tsx");
const History = () => "Earlier message";

const panes = (...elementIds: string[]): PanesValue => ({
  root: {
    type: "leaf",
    id: "composer",
    elementIds,
    activeElementId: elementIds[0],
    presentation: elementIds.length > 1 ? "tabs" : "single",
  },
});

const renderEditor = (format: "plain" | "markdown", value: PanesValue, history = false) =>
  renderToString(() =>
    createComponent(MailComposerEditor, {
      format: () => format,
      body: () => "Draft body",
      onBodyInput: () => undefined,
      editable: () => true,
      completions: () => [],
      panes: () => value,
      onPanesChange: () => undefined,
      preview: () => null,
      previewLoading: () => false,
      previewError: () => undefined,
      onRetryPreview: () => undefined,
      onEditorReady: () => undefined,
      history: history ? createComponent(History, {}) : undefined,
    }),
  );

describe("MailComposerEditor", () => {
  test("adds conversation history beside the plain-text editor", () => {
    const html = renderEditor("plain", panes("editor", "history"), true);

    expect(html).toContain("Write");
    expect(html).toContain("History");
    expect(html).toContain("Earlier message");
    expect(html).not.toContain("Preview");
  });

  test("keeps a standalone plain-text message as a single editor", () => {
    const html = renderEditor("plain", panes("editor"));

    expect(html).toContain('aria-label="Message body"');
    expect(html).not.toContain("History");
    expect(html).not.toContain("Preview");
  });

  test("keeps preview and adds history for a Markdown conversation", () => {
    const html = renderEditor("markdown", panes("editor", "preview", "history"), true);

    expect(html).toContain("Write");
    expect(html).toContain("Preview");
    expect(html).toContain("History");
  });
});
