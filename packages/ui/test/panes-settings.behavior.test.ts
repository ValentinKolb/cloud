import { describe, expect, test } from "bun:test";
import { createComponent, createSignal } from "solid-js";
import { isServer, render } from "solid-js/web";
import { PANES_VALUE_VERSION, type PanesValue } from "../src/layout/panes-state";
import { createDomTestHarness } from "./dom";

describe("@k2b/ui Panes and SettingsModal behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("keeps pane slot props live and exposes one roving tab stop", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [title, setTitle] = createSignal("Source");
    const [icon, setIcon] = createSignal("ti ti-code");
    const [value, setValue] = createSignal<PanesValue>({
      version: PANES_VALUE_VERSION,
      root: {
        type: "leaf",
        id: "root",
        elementIds: ["source", "preview"],
        activeElementId: "source",
        presentation: "tabs",
      },
    });
    const closed: string[] = [];

    const dispose = render(() => {
      const elements = [
        createComponent(Panes.Element, {
          id: "source",
          get title() {
            return title();
          },
          get icon() {
            return icon();
          },
          onClose: () => closed.push("source"),
          children: "Source editor",
        }),
        createComponent(Panes.Element, {
          id: "preview",
          title: "Preview",
          onClose: () => closed.push("preview"),
          children: "Preview",
        }),
      ];

      return createComponent(Panes.Root, {
        get value() {
          return value();
        },
        onValueChange: setValue,
        get children() {
          return elements;
        },
      });
    }, dom.root);

    const tabs = () => Array.from(dom.root.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs()).toHaveLength(2);
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    expect(tabs()[0]?.getAttribute("aria-posinset")).toBe("1");
    expect(tabs()[1]?.getAttribute("aria-posinset")).toBe("2");
    expect(tabs()[0]?.getAttribute("aria-setsize")).toBe("2");
    expect(tabs()[0]?.parentElement?.getAttribute("role")).toBe("tablist");
    expect(
      Array.from(
        dom.root.querySelectorAll<HTMLElement>(".k2b-panes__drag, .k2b-panes__close"),
      ).every(
        (control) => control.tabIndex === -1,
      ),
    ).toBe(true);

    setTitle("Renamed source");
    setIcon("ti ti-file-text");
    expect(tabs()[0]?.textContent).toContain("Renamed source");
    expect(tabs()[0]?.querySelector(".k2b-panes__icon")?.className).toContain("ti-file-text");
    expect(dom.root.querySelector(".k2b-panes__close")?.getAttribute("title")).toBe(
      "Close Renamed source",
    );

    tabs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await Promise.resolve();
    expect(tabs()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs()[1]?.tabIndex).toBe(0);
    const activeTab = tabs()[1] ?? null;
    expect(activeTab).not.toBeNull();
    expect(dom.document.activeElement).toBe(activeTab);

    activeTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(closed).toEqual(["preview"]);

    dispose();
    dom.cleanup();
  });

  test("keeps single-pane drag and close controls out of the tab order", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const value: PanesValue = {
      version: PANES_VALUE_VERSION,
      root: {
        type: "split",
        id: "root",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          {
            type: "leaf",
            id: "source-leaf",
            elementIds: ["source"],
            activeElementId: "source",
            presentation: "single",
          },
          {
            type: "leaf",
            id: "preview-leaf",
            elementIds: ["preview"],
            activeElementId: "preview",
            presentation: "single",
          },
        ],
      },
    };

    const dispose = render(
      () =>
        createComponent(Panes.Root, {
          value,
          onValueChange: () => undefined,
          get children() {
            return [
              createComponent(Panes.Element, {
                id: "source",
                title: "Source",
                closable: true,
                onClose: () => undefined,
                children: "Source editor",
              }),
              createComponent(Panes.Element, {
                id: "preview",
                title: "Preview",
                closable: true,
                onClose: () => undefined,
                children: "Preview",
              }),
            ];
          },
        }),
      dom.root,
    );

    const controls = Array.from(
      dom.root.querySelectorAll<HTMLElement>(".k2b-panes__single-header .k2b-panes__drag, .k2b-panes__single-header .k2b-panes__close"),
    );
    expect(controls).toHaveLength(4);
    expect(controls.every((control) => control.tabIndex === -1)).toBe(true);

    dispose();
    dom.cleanup();
  });

  test("keeps settings tab props live and only controls the rendered panel", async () => {
    const dom = createDomTestHarness();
    const { default: SettingsModal } = await import("../src/layout/SettingsModal");
    const [title, setTitle] = createSignal("General");
    const [icon, setIcon] = createSignal("ti ti-settings");

    const dispose = render(() => {
      const tabs = [
        createComponent(SettingsModal.Tab, {
          id: "general",
          get title() {
            return title();
          },
          get icon() {
            return icon();
          },
          children: "General content",
        }),
        createComponent(SettingsModal.Tab, {
          id: "security",
          title: "Security",
          icon: "ti ti-lock",
          children: "Security content",
        }),
      ];

      return createComponent(SettingsModal, {
        title: "Application settings",
        get children() {
          return tabs;
        },
      });
    }, dom.root);

    const tabs = () => Array.from(dom.root.querySelectorAll<HTMLElement>('[role="tab"]'));
    const activeControls = () => tabs().find((tab) => tab.getAttribute("aria-selected") === "true")
      ?.getAttribute("aria-controls");

    expect(tabs()[0]?.getAttribute("aria-controls")).toBeTruthy();
    expect(tabs()[1]?.hasAttribute("aria-controls")).toBe(false);
    expect(dom.document.getElementById(activeControls() ?? "")).not.toBeNull();

    setTitle("Workspace");
    setIcon("ti ti-layout");
    expect(tabs()[0]?.textContent).toContain("Workspace");
    expect(tabs()[0]?.querySelector("i")?.className).toContain("ti-layout");
    expect(dom.root.querySelector("h2")?.textContent).toBe("Workspace");

    tabs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tabs()[0]?.hasAttribute("aria-controls")).toBe(false);
    expect(tabs()[1]?.getAttribute("aria-controls")).toBeTruthy();
    expect(dom.document.getElementById(activeControls() ?? "")?.textContent).toContain(
      "Security content",
    );

    dispose();
    dom.cleanup();
  });
});
