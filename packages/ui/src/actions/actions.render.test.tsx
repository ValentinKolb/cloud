import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { DropdownItem as PublicDropdownItem } from "../index";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-actions-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const {
  ContextMenu,
  CopyButton,
  Dropdown,
  dropdownPosition,
  FilterChip,
  isSpotlightShortcut,
  RemoveBtn,
  SegmentedControl,
  SpotlightButton,
} = await import("../index");

describe("@k2b/ui complete action migrations", () => {
  test("renders sections, links, actions, and free dropdown elements", () => {
    const elements: PublicDropdownItem[] = [
      { label: "Rename", icon: "ti ti-pencil", action: () => {} },
      {
        sectionLabel: "Links",
        items: [{ label: "Documentation", href: "/docs" }, { element: "Custom" }],
      },
    ];
    const html = renderToString(() =>
      createComponent(Dropdown, {
        label: "Project actions",
        trigger: "Open",
        elements,
      }),
    );

    expect(html).toContain('popover="auto"');
    expect(html).toContain('role="menu"');
    expect(html).toContain("Project actions");
    expect(html).toContain("Links");
    expect(html).toContain('href="/docs"');
    expect(html).toContain("Custom");
  });

  test("clamps every dropdown position to the viewport", () => {
    const trigger = { left: 290, right: 310, top: 180, bottom: 200 } as DOMRect;
    const bottom = dropdownPosition(trigger, { width: 120, height: 80 }, "bottom-right", { width: 320, height: 240 });
    const top = dropdownPosition(trigger, { width: 120, height: 80 }, "top-left", { width: 320, height: 240 });

    expect(bottom).toEqual({ left: 192, top: 152 });
    expect(top).toEqual({ left: 190, top: 96 });
  });

  test("renders section-aware filter state and reset action", () => {
    const html = renderToString(() =>
      createComponent(FilterChip, {
        label: "State",
        icon: "ti ti-filter",
        value: ["open", "urgent"],
        onChange: () => {},
        defaultValue: ["open"],
        options: [
          {
            label: "State",
            options: [
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ],
          },
          {
            label: "Flags",
            multiple: true,
            options: [{ value: "urgent", label: "Urgent", color: "#ef4444" }],
          },
        ],
      }),
    );

    expect(html).toContain('data-active="true"');
    expect(html).toContain('role="menuitemcheckbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Reset");
  });

  test("renders accessor-based segmented controls with icons and disabled options", () => {
    const html = renderToString(() =>
      createComponent(SegmentedControl, {
        ariaLabel: "Layout",
        value: () => "table",
        onChange: () => {},
        options: [
          { value: "table", label: "Table", icon: "ti ti-table" },
          { value: "cards", label: "Cards", disabled: true },
        ],
      }),
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Layout"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("ti ti-table");
    expect(html).toContain("disabled");
  });

  test("renders copy, remove, context, and every spotlight trigger contract", () => {
    const copy = renderToString(() => createComponent(CopyButton, { text: "value" }));
    const remove = renderToString(() => createComponent(RemoveBtn, { ariaLabel: "Remove member", loading: true }));
    const context = renderToString(() =>
      createComponent(ContextMenu, {
        items: [{ id: "remove", label: "Remove", danger: true }],
        children: "Target",
      }),
    );
    const spotlight = renderToString(() =>
      createComponent(SpotlightButton, {
        variant: "sidebar",
        shortcutLabel: "Ctrl K",
        onClick: () => {},
      }),
    );

    expect(copy).toContain('aria-label="Copy"');
    expect(copy).toContain('role="tooltip"');
    expect(remove).toContain('aria-label="Remove member"');
    expect(remove).toContain('aria-busy="true"');
    expect(context).toContain('role="group"');
    expect(context).toContain("Target");
    expect(spotlight).toContain('data-variant="sidebar"');
    expect(spotlight).toContain("Ctrl K");
  });

  test("recognizes the cross-platform spotlight shortcut", () => {
    expect(isSpotlightShortcut({ metaKey: true, ctrlKey: false, shiftKey: true, key: "K" } as KeyboardEvent)).toBe(true);
    expect(isSpotlightShortcut({ metaKey: false, ctrlKey: true, shiftKey: true, key: "k" } as KeyboardEvent)).toBe(true);
    expect(isSpotlightShortcut({ metaKey: true, ctrlKey: false, shiftKey: false, key: "k" } as KeyboardEvent)).toBe(false);
  });
});
