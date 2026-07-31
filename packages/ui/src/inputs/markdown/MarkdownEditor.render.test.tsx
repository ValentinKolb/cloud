import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import { focusSignalCount, parseCssRules } from "../../styles/css-contract-test-helpers";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-editors-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { AutocompleteEditor } = await import("../AutocompleteEditor");
const { MarkdownEditor } = await import("./MarkdownEditor");
const { TextInput } = await import("../TextInput");

describe("source-faithful editor SSR contracts", () => {
  test("renders autocomplete ARIA and a visible overlay placeholder shim", () => {
    const html = renderToString(() =>
      createComponent(AutocompleteEditor, {
        label: "Formula",
        value: "",
        placeholder: "Type a formula",
        highlight: (text: string) => text,
        completions: [
          {
            trigger: "=",
            dropdown: true,
            suggest: () => [{ text: "=SUM(" }],
          },
        ],
      }),
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).not.toContain("aria-expanded");
    expect(html).toContain("k2b-autocomplete__placeholder");
  });

  test("renders the complete toolbar and source stats topology", () => {
    const html = renderToString(() =>
      createComponent(MarkdownEditor, {
        label: "Notes",
        value: "# Hello",
        onSave: () => undefined,
      }),
    );
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("Heading 1 (Ctrl/Cmd+Shift+1)");
    expect(html).toContain("Inline code (Ctrl/Cmd+E)");
    expect(html).toContain("k2b-markdown-editor__separator");
    expect(html).toContain("<span>1 line</span>");
    expect(html).toContain("<span>2 words</span>");
    expect(html).toContain("ti ti-device-floppy");
  });

  test("delegates markdown TextInput field chrome to MarkdownEditor", () => {
    const html = renderToString(() =>
      createComponent(TextInput, {
        markdown: true,
        label: "Notes",
        description: "Supports Markdown",
        value: "# Hello",
      }),
    );
    expect(html.match(/class="k2b-field(?:\s|")/g)).toHaveLength(1);
    expect(html).toContain('for="');
    expect(html).toContain("Supports Markdown");
  });

  test("renders the markdown overlay with a caret anchor the dropdown can measure", async () => {
    const { highlight } = await import("@k2b/stdlib");
    const { renderWithOverlay } = await import("../completion");

    const ghosted = renderWithOverlay("Ask @al", (text) => highlight.markdown(text, { knownLabels: new Set(["@alice"]) }), {
      ghost: { at: 7, text: "ice" },
    });
    expect(ghosted).toContain('class="k2b-completion-ghost" data-completion-anchor');
    expect(ghosted).toContain("k2b-completion-ghost__arrow");
    expect(ghosted).not.toContain(String.fromCharCode(0xe010));

    // No ghost (typed text already equals the row) still needs a measurable
    // anchor, otherwise the popover falls back to the whole-textarea rect.
    const anchored = renderWithOverlay("# Title", (text) => highlight.markdown(text, {}), { anchor: { at: 7 } });
    expect(anchored).toContain('class="k2b-completion-anchor" data-completion-anchor');
    expect(anchored).toContain('class="md-h1"');
    expect(anchored).toContain('class="md-syntax"');
  });

  test("keeps the plain autocomplete textarea readable and single-line sized", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../../styles/editors-parity.css")).text();

    // Transparent selection text is only correct in overlay mode, where the
    // glyphs come from the preview layer.
    expect(css).toContain('.k2b-ui .k2b-autocomplete[data-overlay="true"] .k2b-autocomplete__input::selection');
    expect(css).not.toMatch(/^\.k2b-ui \.k2b-autocomplete__input::selection/m);
    expect(css).toContain('.k2b-ui .k2b-autocomplete:not([data-overlay="true"]) .k2b-autocomplete__input {');
    expect(css).toContain('.k2b-ui .k2b-autocomplete[data-single-line="true"]');
  });

  test("keeps the recessed editor well while focused", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../../styles/editors-parity.css")).text();
    const focusRules = [...css.matchAll(/\.k2b-ui \.k2b-(?:autocomplete|markdown-editor):focus-within \{([^}]*)\}/g)].map(
      (match) => match[1] ?? "",
    );

    expect(focusRules).toHaveLength(2);
    for (const rule of focusRules) {
      expect(rule).toContain("border-color: var(--k2b-focus-ring)");
      expect(rule).not.toMatch(/box-shadow:\s*none/);
      expect(rule).toMatch(/box-shadow:\s*inset/);
    }
  });

  test("uses one complete focus border on a neutral editor surface", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../../styles/editors-parity.css")).text();
    const rules = parseCssRules("editors-parity.css", css);

    for (const selector of [
      ".k2b-ui .k2b-autocomplete:focus-within",
      ".k2b-ui .k2b-markdown-editor:focus-within",
    ]) {
      const body = rules.filter((rule) => rule.selector === selector).map((rule) => rule.body).join(";");
      expect(body, selector).toContain("outline: none");
      expect(body, selector).toContain("border-color: var(--k2b-focus-ring)");
      expect(body, selector).toContain("background: var(--k2b-surface)");
      expect(focusSignalCount(body), selector).toBe(1);
    }
    expect(css).not.toContain("inset 0 0 0 2px var(--k2b-focus-ring)");
    expect(css).not.toContain("outline: 2px solid var(--k2b-focus-ring)");
  });
});
