import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import {
  abbreviations,
  applyCompletion,
  collectKnownLabels,
  detectCompletion,
  displayLabel,
  renderWithOverlay,
} from "./completion";
import {
  clampImageCropRect,
  getInitialImageCropRect,
  imageCropRectToPixels,
  normalizeImageCropRotation,
} from "./image-crop";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-advanced-inputs-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const {
  AutocompleteEditor,
  FileDropzone,
  IconInput,
  ImageInput,
  MarkdownEditor,
  NumberInput,
  TemplateEditor,
  TemplatePreview,
  TemplateSampleData,
  TextInput,
} = await import("../index");

describe("@k2b/ui complete advanced input migrations", () => {
  test("detects, labels, renders and applies generic completions", () => {
    const completion = {
      trigger: "@",
      dropdown: true,
      suggest: () => [{ text: "@alice", hint: "person" }],
    };
    const context = detectCompletion("Hi @al", 6, [completion]);
    expect(context?.query).toBe("al");
    expect(displayLabel({ text: "@alice" }, completion)).toBe("alice");
    expect(applyCompletion("Hi @al", context!, { text: "@alice" })).toEqual({ value: "Hi @alice ", caret: 10 });
    expect(renderWithOverlay("hello", (value) => value, { ghost: { at: 5, text: " world" } })).toContain(
      "data-completion-anchor",
    );
    expect(collectKnownLabels([abbreviations({ brb: "be right back" })])).toEqual(new Set(["brb"]));
  });

  test("renders completion and markdown editor accessibility contracts", () => {
    const autocomplete = renderToString(() =>
      createComponent(AutocompleteEditor, {
        label: "Formula",
        value: "=SUM(",
        completions: [{ trigger: "(", dropdown: true, allowAfterWord: true, suggest: () => [{ text: "(revenue" }] }],
        singleLine: true,
      }),
    );
    const markdown = renderToString(() =>
      createComponent(MarkdownEditor, {
        label: "Notes",
        value: "# Hello",
        abbreviations: { brb: "be right back" },
        onSave: () => {},
      }),
    );

    expect(autocomplete).toContain('role="textbox"');
    expect(autocomplete).toContain('aria-multiline="false"');
    expect(autocomplete).toContain("k2b-autocomplete");
    expect(markdown).toContain('role="toolbar"');
    expect(markdown).toContain('aria-label="Bold"');
    expect(markdown).toContain("1 lines · 2 words");
    expect(markdown).toContain("ti ti-device-floppy");
  });

  test("renders complete text and numeric controls", () => {
    const text = renderToString(() =>
      createComponent(TextInput, {
        label: "Password",
        value: "secret",
        password: true,
        prefix: "ID",
        suffix: ".internal",
      }),
    );
    const number = renderToString(() =>
      createComponent(NumberInput, {
        label: "Price",
        value: 12.5,
        decimalPlaces: 2,
        prefix: "€",
        suffix: "gross",
        clearable: true,
      }),
    );

    expect(text).toContain('type="password"');
    expect(text).toContain("Show password");
    expect(number).toContain('role="spinbutton"');
    expect(number).toContain('aria-label="Decrease value"');
    expect(number).toContain('aria-label="Increase value"');
    expect(number).toContain("gross");
    expect(number).toContain('aria-label="Clear"');
  });

  test("renders generic file, image and icon controls", () => {
    const dropzone = renderToString(() =>
      createComponent(FileDropzone, {
        label: "Attachments",
        accept: "image/*",
        multiple: false,
        onDrop: () => {},
      }),
    );
    const image = renderToString(() =>
      createComponent(ImageInput, {
        label: "Avatar",
        value: "data:image/png;base64,abc",
        variant: "small",
        round: true,
        onValueChange: () => {},
      }),
    );
    const icon = renderToString(() =>
      createComponent(IconInput, {
        label: "Icon",
        value: "ti ti-home",
        options: [{ value: "ti ti-home", label: "Home", icon: "ti ti-home", keywords: ["house"] }],
      }),
    );

    expect(dropzone).toContain("k2b-dropzone");
    expect(dropzone).toContain('accept="image/*"');
    expect(dropzone).not.toContain(" multiple");
    expect(image).toContain('data-variant="small"');
    expect(image).toContain("Remove");
    expect(icon).toContain('role="combobox"');
    expect(icon).toContain("Home");
  });

  test("renders template editor, sandboxed preview and sample data", () => {
    const editor = renderToString(() =>
      createComponent(TemplateEditor, {
        value: "<p>{{ APP_NAME }}</p>",
        variables: [{ name: "APP_NAME", kind: "string" }],
      }),
    );
    const preview = renderToString(() => createComponent(TemplatePreview, { html: "<p>Hello</p>" }));
    const sample = renderToString(() =>
      createComponent(TemplateSampleData, {
        variables: [{ name: "APP_NAME" }],
        values: { APP_NAME: "Cloud" },
        onValueChange: () => {},
      }),
    );

    expect(editor).toContain("Write HTML with Liquid values");
    expect(preview).toContain("sandbox");
    expect(preview).toContain('title="Template preview"');
    expect(sample).toContain("{{ APP_NAME }}");
    expect(sample).toContain('value="Cloud"');
  });

  test("normalizes crop geometry and rotations", () => {
    const initial = getInitialImageCropRect({ width: 1600, height: 900 }, { width: 1, height: 1 });
    expect(initial.width).toBeLessThan(initial.height);
    expect(clampImageCropRect({ x: -1, y: 2, width: 2, height: 0 }, { width: 100, height: 100 })).toEqual({
      x: 0,
      y: 0.92,
      width: 1,
      height: 0.08,
    });
    expect(imageCropRectToPixels({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, { width: 1000, height: 500 })).toEqual({
      x: 100,
      y: 100,
      width: 500,
      height: 200,
    });
    expect(normalizeImageCropRotation(-90)).toBe(270);
  });
});
