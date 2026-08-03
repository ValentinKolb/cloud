import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-settings-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { readSettingsError, sameSettingValue, SettingsField, SettingsModal, SettingsPage, SettingsPanelFooter, SettingsSaveBar, SettingsSection } =
  await import("../index");

describe("@k2b/ui complete settings surfaces", () => {
  test("renders a flat full-page settings shell", () => {
    const html = renderToString(() =>
      createComponent(SettingsPage, {
        title: "AI providers",
        subtitle: "Models and credentials",
        icon: "ti ti-sparkles",
        actions: "toolbar",
        footer: "save controls",
        scrollPreserveKey: "providers",
        children: "provider cards",
      }),
    );

    expect(html).toContain('class="k2b-settings-page"');
    expect(html).toContain("<h1>AI providers</h1>");
    expect(html).toContain("Models and credentials");
    expect(html).toContain('data-scroll-preserve="providers"');
    expect(html).toContain("provider cards");
    expect(html).toContain("save controls");
    expect(html).not.toContain("k2b-panel-dialog");
  });

  test("renders an accessible controlled tab surface", () => {
    const html = renderToString(() =>
      createComponent(SettingsModal, {
        title: "Application settings",
        activeTab: "security",
        children: [
          createComponent(SettingsModal.Tab, {
            id: "general",
            title: "General",
            children: "General content",
          }),
          createComponent(SettingsModal.Tab, {
            id: "security",
            title: "Security",
            description: "Authentication controls",
            icon: "ti ti-lock",
            tone: "danger",
            children: "Security content",
          }),
        ],
      }),
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("Security content");
    expect(html).not.toContain("General content");
  });

  test("separates full-page settings sections from dialog sections", () => {
    const html = renderToString(() =>
      createComponent(SettingsSection, {
        title: "Identity",
        subtitle: "Workspace name and URL",
        icon: "ti ti-id",
        actions: "section action",
        children: "settings fields",
      }),
    );

    expect(html).toContain('class="k2b-settings-section"');
    expect(html).toContain(">Identity</h2>");
    expect(html).toMatch(/aria-labelledby="k2b-settings-section-[^"]+"/);
    expect(html).toContain("Workspace name and URL");
    expect(html).toContain("section action");
    expect(html).not.toContain("k2b-panel-dialog");
  });

  test("renders changed fields and sticky or fixed save controls", () => {
    const field = renderToString(() =>
      createComponent(SettingsField, {
        label: "Endpoint",
        description: "Public service URL",
        changed: () => true,
        error: () => "Invalid URL",
        children: "control",
      }),
    );
    const bar = renderToString(() =>
      createComponent(SettingsSaveBar, { changeCount: 2, loading: () => false, onDiscard: () => {}, onSave: () => {} }),
    );
    const footer = renderToString(() =>
      createComponent(SettingsPanelFooter, {
        changeCount: 0,
        loading: () => false,
        onDiscard: () => {},
        onSave: () => {},
        saveVariant: "ai",
      }),
    );

    expect(field).toContain("Unsaved");
    expect(field).toContain('role="alert"');
    expect(bar).toContain("2</strong> unsaved changes");
    expect(footer).toContain("No unsaved changes");
    expect(footer).toContain('data-variant="ai"');
    expect(footer.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);

    // Cloud labels the save action with a floppy glyph on both surfaces; the
    // port rendered a bare text button.
    expect(bar).toContain("ti ti-device-floppy");
    expect(footer).toContain("ti ti-device-floppy");
    expect(bar).toContain("Save changes");
    expect(footer).toContain("Save changes");
  });

  test("compares setting values and safely parses API failures", async () => {
    expect(sameSettingValue({ enabled: true }, { enabled: true })).toBe(true);
    expect(sameSettingValue(["a", "b"], ["b", "a"])).toBe(false);

    const parsed = await readSettingsError(
      new Response(JSON.stringify({ message: "Validation failed", errors: { endpoint: "Required" } })),
      "Could not save",
    );
    const fallback = await readSettingsError(new Response("not json"), "Could not save");

    expect(parsed).toEqual({ message: "Validation failed", fields: { endpoint: "Required" } });
    expect(fallback).toEqual({ message: "Could not save", fields: {} });
  });
});
