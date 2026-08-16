import { describe, expect, test } from "bun:test";
import { createComponent, createSignal } from "solid-js";
import { isServer, render } from "solid-js/web";
import { applyPanesIntent, type PanesLayout } from "../src/layout/panes-layout";
import { createDomTestHarness } from "./dom";

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  right: left + width,
  top,
  bottom: top + height,
  width,
  height,
  toJSON: () => ({}),
});

describe("@k2b/ui Panes and SettingsModal behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("keeps one roving tab stop, active-only content, and separate close chrome", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [layout, setLayout] = createSignal<PanesLayout>({
      version: 2,
      root: { type: "group", items: ["source", "preview"], active: "source" },
    });
    const closed: string[] = [];
    const dispose = render(
      () =>
        createComponent(Panes, {
          get layout() {
            return layout();
          },
          onLayoutChange: setLayout,
          items: [
            { id: "source", title: "Source", icon: "ti ti-code", onClose: () => closed.push("source"), render: () => "Source editor" },
            { id: "preview", title: "Preview", onClose: () => closed.push("preview"), render: () => "Preview content" },
          ],
        }),
      dom.root,
    );

    const tabs = () => Array.from(dom.root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs()).toHaveLength(2);
    expect(tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    expect(tabs()[0]?.getAttribute("aria-controls")).toBeTruthy();
    expect(tabs()[1]?.hasAttribute("aria-controls")).toBe(false);
    expect(tabs()[0]?.parentElement?.parentElement?.getAttribute("role")).toBe("tablist");
    expect(dom.root.textContent).toContain("Source editor");
    expect(dom.root.textContent).not.toContain("Preview content");
    const closes = Array.from(dom.root.querySelectorAll<HTMLButtonElement>(".k2b-panes__close"));
    expect(closes).toHaveLength(2);
    expect(closes.every((close) => close.parentElement?.querySelector('[role="tab"]') !== close)).toBe(true);
    expect(tabs()[0]?.contains(closes[0] ?? null)).toBe(false);

    tabs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await Promise.resolve();
    expect(tabs()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs()[0]?.hasAttribute("aria-controls")).toBe(false);
    expect(tabs()[1]?.getAttribute("aria-controls")).toBeTruthy();
    expect(dom.root.textContent).toContain("Preview content");
    expect(dom.root.textContent).not.toContain("Source editor");
    tabs()[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(closed).toEqual(["preview"]);
    closes[0]?.click();
    expect(closed).toEqual(["preview", "source"]);

    dispose();
    dom.cleanup();
  });

  test("passes group and empty-workspace add targets to the consumer", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [layout, setLayout] = createSignal<PanesLayout>({
      version: 2,
      root: { type: "group", items: ["source"], active: "source" },
    });
    const targets: Array<string | null> = [];
    const dispose = render(
      () =>
        createComponent(Panes, {
          get layout() {
            return layout();
          },
          onLayoutChange: setLayout,
          onAddItem: (target) => targets.push(target),
          items: [{ id: "source", title: "Source", render: () => "Source" }],
        }),
      dom.root,
    );
    const groupAdd = dom.root.querySelector<HTMLButtonElement>(".k2b-panes__add--tab");
    if (!groupAdd) throw new Error(dom.root.innerHTML);
    const addClick = (groupAdd as HTMLButtonElement & { $$click?: () => void }).$$click;
    expect(typeof addClick).toBe("function");
    addClick?.();
    expect(targets).toEqual(["source"]);
    setLayout({ version: 2, root: null });
    await Promise.resolve();
    const emptyAdd = dom.root.querySelector<HTMLButtonElement>(".k2b-panes__empty .k2b-panes__add");
    const emptyAddClick = (emptyAdd as (HTMLButtonElement & { $$click?: () => void }) | null)?.$$click;
    expect(typeof emptyAddClick).toBe("function");
    emptyAddClick?.();
    expect(targets).toEqual(["source", null]);
    dispose();
    dom.cleanup();
  });

  test("keeps active content mounted across same-group reorder and descriptor rebuilds", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [layout, setLayout] = createSignal<PanesLayout>({
      version: 2,
      root: { type: "group", items: ["one", "two"], active: "one" },
    });
    const [descriptorVersion, setDescriptorVersion] = createSignal(0);
    let renders = 0;
    const dispose = render(
      () =>
        createComponent(Panes, {
          get layout() {
            return layout();
          },
          onLayoutChange: setLayout,
          get items() {
            descriptorVersion();
            return [
              {
                id: "one",
                title: "One",
                render: () => {
                  renders += 1;
                  return "One";
                },
              },
              { id: "two", title: "Two", render: () => "Two" },
            ];
          },
        }),
      dom.root,
    );
    expect(renders).toBe(1);
    setLayout(applyPanesIntent(layout(), { type: "tab", itemId: "one", targetItemId: "two", beforeItemId: null }));
    setDescriptorVersion(1);
    await Promise.resolve();
    expect(layout().root).toEqual({ type: "group", items: ["two", "one"], active: "one" });
    expect(renders).toBe(1);
    expect(dom.root.textContent).toContain("One");
    dispose();
    dom.cleanup();
  });

  test("shows explicit targets and drops through the advertised group intent", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [layout, setLayout] = createSignal<PanesLayout>({
      version: 2,
      root: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        first: { type: "group", items: ["source"], active: "source" },
        second: { type: "group", items: ["preview"], active: "preview" },
      },
    });
    const dispose = render(
      () =>
        createComponent(Panes, {
          get layout() {
            return layout();
          },
          onLayoutChange: setLayout,
          items: [
            { id: "source", title: "Source", render: () => "Source" },
            { id: "preview", title: "Preview", render: () => "Preview" },
          ],
        }),
      dom.root,
    );
    const groups = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__group"));
    const tabs = Array.from(dom.root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    if (groups.length !== 2 || tabs.length !== 2) throw new Error("Expected two pane groups");
    groups[0]!.getBoundingClientRect = () => rect(0, 0, 300, 180);
    groups[1]!.getBoundingClientRect = () => rect(0, 180, 300, 180);
    tabs[0]!.getBoundingClientRect = () => rect(0, 0, 120, 40);
    tabs[1]!.getBoundingClientRect = () => rect(0, 180, 120, 40);
    const source = tabs[0]!.parentElement;
    if (!source?.matches("[data-dnd-draggable]")) throw new Error("Expected draggable source tab");
    source.getBoundingClientRect = () => rect(0, 0, 120, 40);
    tabs[0]!.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 20,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
      }) as unknown as Event,
    );
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        clientX: 30,
        clientY: 30,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    const targets = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__drop-target"));
    if (targets.length === 0) throw new Error(dom.root.innerHTML);
    expect(targets.some((target) => target.dataset.kind === "group")).toBe(true);
    expect(targets.some((target) => target.dataset.kind === "split")).toBe(true);
    expect(targets.some((target) => target.dataset.disabled)).toBe(false);
    const groupTarget = groups[1]!.querySelector<HTMLElement>('[data-kind="group"]');
    if (!groupTarget) throw new Error("Expected group target");
    groupTarget.getBoundingClientRect = () => rect(80, 240, 140, 48);
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        clientX: 120,
        clientY: 260,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(groupTarget.dataset.active).toBe("true");
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointerup", {
        clientX: 120,
        clientY: 260,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(layout().root).toEqual({ type: "group", items: ["preview", "source"], active: "source" });
    expect(dom.root.querySelector(".k2b-panes__drop-target")).toBeNull();
    dispose();
    dom.cleanup();
  });

  test("uses the advertised tab and trapezoid intents for keyboard drops", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const press = (element: HTMLElement, key: string) =>
      element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as unknown as Event);
    const chooseTarget = async (source: HTMLButtonElement, target: () => HTMLElement | null) => {
      press(source, " ");
      await Promise.resolve();
      const targets = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__drop-target"));
      targets.forEach((candidate, index) => {
        const verticalEdge = candidate.dataset.zone === "left" || candidate.dataset.zone === "right";
        const horizontalEdge = candidate.dataset.zone === "top" || candidate.dataset.zone === "bottom";
        const width = verticalEdge ? 48 : 120;
        const height = horizontalEdge ? 48 : candidate.dataset.kind === "split" ? 200 : 48;
        candidate.getBoundingClientRect = () => rect(index * 240, index * 240, width, height);
      });
      const wanted = target();
      if (!wanted) throw new Error(dom.root.innerHTML);
      if (wanted.dataset.zone) expect(wanted.title).toMatch(/^Add (top|right|bottom|left) of /);
      press(source, "ArrowLeft");
      await Promise.resolve();
      for (let index = 0; index < targets.length && wanted.dataset.active !== "true"; index += 1) {
        press(source, "ArrowRight");
        await Promise.resolve();
      }
      expect(wanted.dataset.active).toBe("true");
      press(source, " ");
      await Promise.resolve();
    };

    const [layout, setLayout] = createSignal<PanesLayout>({
      version: 2,
      root: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        first: { type: "group", items: ["source"], active: "source" },
        second: { type: "group", items: ["preview"], active: "preview" },
      },
    });
    const items = [
      { id: "source", title: "Source", render: () => "Source" },
      { id: "preview", title: "Preview", render: () => "Preview" },
    ];
    const dispose = render(
      () =>
        createComponent(Panes, {
          get layout() {
            return layout();
          },
          onLayoutChange: setLayout,
          items,
        }),
      dom.root,
    );
    const source = dom.root.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Source"]');
    if (!source) throw new Error(dom.root.innerHTML);
    source.parentElement!.getBoundingClientRect = () => rect(0, 0, 120, 40);
    await chooseTarget(
      source,
      () =>
        Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__group"))[1]?.querySelector<HTMLElement>('[data-zone="right"]') ??
        null,
    );
    expect(layout().root).toEqual({
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "group", items: ["preview"], active: "preview" },
      second: { type: "group", items: ["source"], active: "source" },
    });
    expect(dom.window.document.activeElement?.getAttribute("aria-label")).toBe("Source");
    dispose();

    const [tabsLayout, setTabsLayout] = createSignal<PanesLayout>({
      version: 2,
      root: { type: "group", items: ["source", "middle", "end"], active: "source" },
    });
    const disposeTabs = render(
      () =>
        createComponent(Panes, {
          get layout() {
            return tabsLayout();
          },
          onLayoutChange: setTabsLayout,
          items: [...items, { id: "middle", title: "Middle", render: () => "Middle" }, { id: "end", title: "End", render: () => "End" }],
        }),
      dom.root,
    );
    const sourceTab = dom.root.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Source"]');
    const endTab = dom.root.querySelector<HTMLButtonElement>('[role="tab"][aria-label="End"]');
    if (!sourceTab || !endTab) throw new Error(dom.root.innerHTML);
    sourceTab.parentElement!.getBoundingClientRect = () => rect(0, 0, 120, 40);
    await chooseTarget(sourceTab, () => endTab.parentElement?.querySelector<HTMLElement>('[data-placement="tab"]') ?? null);
    expect(tabsLayout().root).toEqual({ type: "group", items: ["middle", "source", "end"], active: "source" });
    disposeTabs();
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
          children: ["Security content", createComponent(SettingsModal.Footer, { children: "Security save controls" })],
        }),
      ];
      return createComponent(SettingsModal, {
        title: "Application settings",
        get children() {
          return [
            createComponent(SettingsModal.Group, { title: "Workspace", children: tabs[0] }),
            createComponent(SettingsModal.Group, { title: "Restricted", children: tabs[1] }),
          ];
        },
      });
    }, dom.root);
    const tabs = () => Array.from(dom.root.querySelectorAll<HTMLElement>('[role="tab"]'));
    const activeControls = () =>
      tabs()
        .find((tab) => tab.getAttribute("aria-selected") === "true")
        ?.getAttribute("aria-controls");
    expect(tabs()[0]?.getAttribute("aria-controls")).toBeTruthy();
    expect(tabs()[1]?.hasAttribute("aria-controls")).toBe(false);
    setTitle("Workspace");
    setIcon("ti ti-layout");
    expect(tabs()[0]?.textContent).toContain("Workspace");
    tabs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(dom.document.getElementById(activeControls() ?? "")?.textContent).toContain("Security content");
    expect(dom.root.querySelector(".k2b-settings__footer")?.textContent).toContain("Security save controls");
    dispose();
    dom.cleanup();
  });

  test("moves ordered settings items only in available directions", async () => {
    const dom = createDomTestHarness();
    const { default: SettingsCollection } = await import("../src/layout/SettingsCollection");
    const moves: number[] = [];
    const dispose = render(
      () =>
        createComponent(SettingsCollection, {
          title: "Statuses",
          children: createComponent(SettingsCollection.Item, {
            title: "Open",
            children: createComponent(SettingsCollection.Item.Actions, {
              children: createComponent(SettingsCollection.Item.Reorder, {
                label: "Open",
                index: 0,
                count: 2,
                onMove: (direction) => moves.push(direction),
              }),
            }),
          }),
        }),
      dom.root,
    );
    const up = dom.root.querySelector<HTMLButtonElement>('[aria-label="Move Open up"]');
    const down = dom.root.querySelector<HTMLButtonElement>('[aria-label="Move Open down"]');
    expect(up?.disabled).toBe(true);
    expect(down?.disabled).toBe(false);
    up?.click();
    down?.click();
    expect(moves).toEqual([1]);
    dispose();
    dom.cleanup();
  });
});
