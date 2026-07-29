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

const { readSettingsError, sameSettingValue, SettingsField, SettingsModal, SettingsPanelFooter, SettingsSaveBar } =
  await import("../index");

describe("@k2b/ui complete settings surfaces", () => {
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
      }),
    );

    expect(field).toContain("Unsaved");
    expect(field).toContain('role="alert"');
    expect(bar).toContain("2</strong> unsaved changes");
    expect(footer).toContain("No unsaved changes");
    expect(footer.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);

    // Cloud labels the save action with a floppy glyph on both surfaces; the
    // port rendered a bare text button.
    expect(bar).toContain("ti ti-device-floppy");
    expect(footer).toContain("ti ti-device-floppy");
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
