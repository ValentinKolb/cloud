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
    expect(dom.root.querySelector(".k2b-panes__drag, [data-panes-drag-handle]")).toBeNull();
    expect(
      tabs().every(
        (tab) =>
          tab.dataset.movable === "true" && tab.querySelector(".k2b-panes__tab-button")?.getAttribute("data-dnd-draggable") === "true",
      ),
    ).toBe(true);
    expect(Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__close")).every((control) => control.tabIndex === -1)).toBe(true);

    setTitle("Renamed source");
    setIcon("ti ti-file-text");
    expect(tabs()[0]?.textContent).toContain("Renamed source");
    expect(tabs()[0]?.querySelector(".k2b-panes__icon")?.className).toContain("ti-file-text");
    const close = dom.root.querySelector<HTMLElement>(".k2b-panes__close");
    expect(close?.getAttribute("title")).toBe("Close Renamed source");
    const dragSurface = tabs()[0]?.querySelector<HTMLElement>("[data-dnd-draggable]");
    expect(dragSurface).not.toBeNull();
    expect(dragSurface?.contains(close ?? null)).toBe(false);

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

  test("reorders tabs through their leading and trailing pointer halves", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [value, setValue] = createSignal<PanesValue>({
      version: PANES_VALUE_VERSION,
      root: {
        type: "leaf",
        id: "root",
        elementIds: ["one", "two", "three"],
        activeElementId: "one",
        presentation: "tabs",
      },
    });

    const dispose = render(
      () =>
        createComponent(Panes.Root, {
          get value() {
            return value();
          },
          onValueChange: setValue,
          get children() {
            return ["one", "two", "three"].map((id) =>
              createComponent(Panes.Element, {
                id,
                title: id,
                children: id,
              }),
            );
          },
        }),
      dom.root,
    );

    const rect = (left: number, width: number, height = 40): DOMRect => ({
      x: left,
      y: 0,
      left,
      right: left + width,
      top: 0,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    });
    const tabs = Array.from(dom.root.querySelectorAll<HTMLElement>('[role="tab"]'));
    const leaf = dom.root.querySelector<HTMLElement>(".k2b-panes__leaf");
    if (!leaf || tabs.length !== 3) throw new Error("Expected one three-tab pane");
    leaf.getBoundingClientRect = () => rect(0, 300, 200);
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => rect(index * 100, 100);
    });
    const source = tabs[0]?.querySelector<HTMLElement>("[data-dnd-draggable]");
    if (!source) throw new Error("Expected draggable first tab");
    source.getBoundingClientRect = () => rect(0, 100);

    source.dispatchEvent(
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
        clientX: 280,
        clientY: 20,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();

    const preview = dom.root.querySelector<HTMLElement>(".k2b-panes__merge-preview");
    expect(preview?.textContent).toContain("one");
    expect(preview?.parentElement?.lastElementChild).toBe(preview ?? null);

    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointerup", {
        clientX: 280,
        clientY: 20,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(value().root).toMatchObject({ elementIds: ["two", "three", "one"], activeElementId: "one" });

    dispose();
    dom.cleanup();
  });

  test("keeps tab reordering active while crossing gaps in the tab row", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [value, setValue] = createSignal<PanesValue>({
      version: PANES_VALUE_VERSION,
      root: {
        type: "leaf",
        id: "root",
        elementIds: ["one", "two", "three"],
        activeElementId: "one",
        presentation: "tabs",
      },
    });

    const dispose = render(
      () =>
        createComponent(Panes.Root, {
          get value() {
            return value();
          },
          onValueChange: setValue,
          get children() {
            return ["one", "two", "three"].map((id) =>
              createComponent(Panes.Element, {
                id,
                title: id,
                children: id,
              }),
            );
          },
        }),
      dom.root,
    );

    const rect = (left: number, width: number, height = 40): DOMRect => ({
      x: left,
      y: 0,
      left,
      right: left + width,
      top: 0,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    });
    const tabs = Array.from(dom.root.querySelectorAll<HTMLElement>('[role="tab"]'));
    const leaf = dom.root.querySelector<HTMLElement>(".k2b-panes__leaf");
    if (!leaf || tabs.length !== 3) throw new Error("Expected one three-tab pane");
    leaf.getBoundingClientRect = () => rect(0, 300, 200);
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => rect(index * 100, 80);
    });
    const source = tabs[0]?.querySelector<HTMLElement>("[data-dnd-draggable]");
    if (!source) throw new Error("Expected draggable first tab");
    source.getBoundingClientRect = () => rect(0, 80);

    source.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 20,
        pointerId: 8,
        pointerType: "mouse",
        isPrimary: true,
      }) as unknown as Event,
    );
    const moveThroughGap = () =>
      dom.window.dispatchEvent(
        new dom.window.PointerEvent("pointermove", {
          clientX: 191,
          clientY: 20,
          pointerId: 8,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
    moveThroughGap();
    await Promise.resolve();

    const preview = dom.root.querySelector<HTMLElement>(".k2b-panes__merge-preview");
    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="top"]')).toBeNull();
    expect(preview?.nextElementSibling).toBe(tabs[2] ?? null);

    moveThroughGap();
    await Promise.resolve();
    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="top"]')).toBeNull();
    expect(preview?.nextElementSibling).toBe(tabs[2] ?? null);

    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointerup", {
        clientX: 191,
        clientY: 20,
        pointerId: 8,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(value().root).toMatchObject({ elementIds: ["two", "one", "three"], activeElementId: "one" });

    dispose();
    dom.cleanup();
  });

  test("returns an upward tab pull to reordering over the tab row", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [value, setValue] = createSignal<PanesValue>({
      version: PANES_VALUE_VERSION,
      root: {
        type: "leaf",
        id: "root",
        elementIds: ["one", "two"],
        activeElementId: "one",
        presentation: "tabs",
      },
    });

    const dispose = render(
      () =>
        createComponent(Panes.Root, {
          get value() {
            return value();
          },
          onValueChange: setValue,
          get children() {
            return ["one", "two"].map((id) =>
              createComponent(Panes.Element, {
                id,
                title: id,
                children: id,
              }),
            );
          },
        }),
      dom.root,
    );

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
    const tabs = Array.from(dom.root.querySelectorAll<HTMLElement>('[role="tab"]'));
    const leaf = dom.root.querySelector<HTMLElement>(".k2b-panes__leaf");
    if (!leaf || tabs.length !== 2) throw new Error("Expected one two-tab pane");
    leaf.getBoundingClientRect = () => rect(0, 0, 200, 200);
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => rect(index * 100, 40, 80, 40);
    });
    const source = tabs[0]?.querySelector<HTMLElement>("[data-dnd-draggable]");
    if (!source) throw new Error("Expected draggable first tab");
    source.getBoundingClientRect = () => rect(0, 40, 80, 40);

    source.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 60,
        pointerId: 9,
        pointerType: "mouse",
        isPrimary: true,
      }) as unknown as Event,
    );
    const move = (clientY: number) =>
      dom.window.dispatchEvent(
        new dom.window.PointerEvent("pointermove", {
          clientX: 170,
          clientY,
          pointerId: 9,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );

    move(29);
    await Promise.resolve();
    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="top"]')).not.toBeNull();
    expect(dom.root.querySelector(".k2b-panes__merge-preview")).toBeNull();

    move(47);
    await Promise.resolve();
    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="top"]')).toBeNull();
    expect(dom.root.querySelector(".k2b-panes__merge-preview")).not.toBeNull();

    move(49);
    await Promise.resolve();
    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="top"]')).toBeNull();
    const preview = dom.root.querySelector(".k2b-panes__merge-preview");
    expect(preview?.parentElement?.lastElementChild).toBe(preview ?? null);

    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointerup", {
        clientX: 170,
        clientY: 49,
        pointerId: 9,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(value().root).toMatchObject({ elementIds: ["two", "one"], activeElementId: "one" });

    dispose();
    dom.cleanup();
  });

  test("joins another tab group even after a large vertical drag", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [value, setValue] = createSignal<PanesValue>({
      version: PANES_VALUE_VERSION,
      root: {
        type: "split",
        id: "root",
        direction: "vertical",
        sizes: [50, 50],
        children: [
          {
            type: "leaf",
            id: "preview-leaf",
            elementIds: ["preview"],
            activeElementId: "preview",
            presentation: "single",
          },
          {
            type: "leaf",
            id: "source-leaf",
            elementIds: ["source"],
            activeElementId: "source",
            presentation: "single",
          },
        ],
      },
    });

    const dispose = render(
      () =>
        createComponent(Panes.Root, {
          get value() {
            return value();
          },
          onValueChange: setValue,
          get children() {
            return ["preview", "source"].map((id) =>
              createComponent(Panes.Element, {
                id,
                title: id === "preview" ? "Preview" : "Source",
                children: id,
              }),
            );
          },
        }),
      dom.root,
    );

    const rect = (top: number, height: number): DOMRect => ({
      x: 0,
      y: top,
      left: 0,
      right: 200,
      top,
      bottom: top + height,
      width: 200,
      height,
      toJSON: () => ({}),
    });
    const leaves = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__leaf"));
    const headers = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__single-header"));
    if (leaves.length !== 2 || headers.length !== 2) throw new Error("Expected two single-pane groups");
    leaves[0]!.getBoundingClientRect = () => rect(0, 100);
    leaves[1]!.getBoundingClientRect = () => rect(100, 100);
    headers[0]!.getBoundingClientRect = () => rect(0, 40);
    headers[1]!.getBoundingClientRect = () => rect(100, 40);
    const previewSurface = headers[0]!.querySelector<HTMLElement>("[data-dnd-draggable]");
    if (!previewSurface) throw new Error("Expected draggable Preview tab");
    previewSurface.getBoundingClientRect = () => rect(0, 40);

    previewSurface.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 20,
        pointerId: 10,
        pointerType: "mouse",
        isPrimary: true,
      }) as unknown as Event,
    );
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        clientX: 40,
        clientY: 120,
        pointerId: 10,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();

    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="bottom"]')).toBeNull();
    const mergePreview = dom.root.querySelector(".k2b-panes__merge-preview");
    expect(mergePreview?.nextElementSibling?.getAttribute("aria-label")).toBe("Source");

    const sourceTab = dom.root.querySelector<HTMLElement>('[role="tab"][aria-label="Source"]');
    if (!sourceTab) throw new Error("Expected Source tab after merge preview");
    sourceTab.getBoundingClientRect = () => rect(100, 40);
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointerup", {
        clientX: 40,
        clientY: 120,
        pointerId: 10,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(value().root).toMatchObject({
      type: "leaf",
      elementIds: ["preview", "source"],
      activeElementId: "preview",
    });

    dispose();
    dom.cleanup();
  });

  test("leaves a target tab strip to split at the pane's right edge", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
    const [value, setValue] = createSignal<PanesValue>({
      version: PANES_VALUE_VERSION,
      root: {
        type: "split",
        id: "root",
        direction: "vertical",
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
    });

    const dispose = render(
      () =>
        createComponent(Panes.Root, {
          get value() {
            return value();
          },
          onValueChange: setValue,
          get children() {
            return ["source", "preview"].map((id) =>
              createComponent(Panes.Element, {
                id,
                title: id === "source" ? "Source" : "Preview",
                children: id,
              }),
            );
          },
        }),
      dom.root,
    );

    const rect = (top: number, height: number): DOMRect => ({
      x: 0,
      y: top,
      left: 0,
      right: 400,
      top,
      bottom: top + height,
      width: 400,
      height,
      toJSON: () => ({}),
    });
    const leaves = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__leaf"));
    const headers = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__single-header"));
    if (leaves.length !== 2 || headers.length !== 2) throw new Error("Expected two single-pane groups");
    leaves[0]!.getBoundingClientRect = () => rect(0, 100);
    leaves[1]!.getBoundingClientRect = () => rect(100, 100);
    headers[0]!.getBoundingClientRect = () => rect(0, 40);
    headers[1]!.getBoundingClientRect = () => rect(100, 40);
    const sourceSurface = headers[0]!.querySelector<HTMLElement>("[data-dnd-draggable]");
    if (!sourceSurface) throw new Error("Expected draggable Source tab");
    sourceSurface.getBoundingClientRect = () => rect(0, 40);

    sourceSurface.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 20,
        pointerId: 11,
        pointerType: "mouse",
        isPrimary: true,
      }) as unknown as Event,
    );
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        clientX: 40,
        clientY: 120,
        pointerId: 11,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(dom.root.querySelector(".k2b-panes__merge-preview")).not.toBeNull();

    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        clientX: 353,
        clientY: 170,
        pointerId: 11,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(dom.root.querySelector(".k2b-panes__merge-preview")).toBeNull();
    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="right"]')).not.toBeNull();

    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointerup", {
        clientX: 353,
        clientY: 170,
        pointerId: 11,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(value().root).toMatchObject({
      type: "split",
      direction: "horizontal",
      children: [{ elementIds: ["preview"] }, { elementIds: ["source"] }],
    });

    dispose();
    dom.cleanup();
  });

  test("keeps a same-pane side split reachable after a vertical drag", async () => {
    const dom = createDomTestHarness();
    const { default: Panes } = await import("../src/layout/Panes");
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

    const dispose = render(
      () =>
        createComponent(Panes.Root, {
          get value() {
            return value();
          },
          onValueChange: setValue,
          get children() {
            return ["source", "preview"].map((id) =>
              createComponent(Panes.Element, {
                id,
                title: id === "source" ? "Source" : "Preview",
                children: id,
              }),
            );
          },
        }),
      dom.root,
    );

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
    const leaf = dom.root.querySelector<HTMLElement>(".k2b-panes__leaf");
    const tabs = Array.from(dom.root.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (!leaf || tabs.length !== 2) throw new Error("Expected one two-tab pane");
    leaf.getBoundingClientRect = () => rect(0, 0, 400, 200);
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => rect(index * 100, 0, 80, 40);
    });
    const previewSurface = tabs[1]!.querySelector<HTMLElement>("[data-dnd-draggable]");
    if (!previewSurface) throw new Error("Expected draggable Preview tab");
    previewSurface.getBoundingClientRect = () => rect(100, 0, 80, 40);

    previewSurface.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 20,
        pointerId: 12,
        pointerType: "mouse",
        isPrimary: true,
      }) as unknown as Event,
    );
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        clientX: 353,
        clientY: 70,
        pointerId: 12,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();

    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="right"]')).not.toBeNull();
    expect(dom.root.querySelector('.k2b-panes__drop-zone[data-zone="bottom"]')).toBeNull();

    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointerup", {
        clientX: 353,
        clientY: 70,
        pointerId: 12,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await Promise.resolve();
    expect(value().root).toMatchObject({
      type: "split",
      direction: "horizontal",
      children: [{ elementIds: ["source"] }, { elementIds: ["preview"] }],
    });

    dispose();
    dom.cleanup();
  });

  test("makes single-pane tab surfaces draggable while keeping close controls separate", async () => {
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

    const headers = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__single-header"));
    const closeControls = Array.from(dom.root.querySelectorAll<HTMLElement>(".k2b-panes__single-header .k2b-panes__close"));
    expect(headers).toHaveLength(2);
    expect(
      headers.every(
        (header) =>
          header.dataset.movable === "true" &&
          header.querySelector(".k2b-panes__tab-button")?.getAttribute("data-dnd-draggable") === "true",
      ),
    ).toBe(true);
    expect(
      headers.every((header) => !header.querySelector("[data-dnd-draggable]")?.contains(header.querySelector(".k2b-panes__close"))),
    ).toBe(true);
    expect(dom.root.querySelector(".k2b-panes__drag, [data-panes-drag-handle]")).toBeNull();
    expect(closeControls).toHaveLength(2);
    expect(closeControls.every((control) => control.tabIndex === -1)).toBe(true);

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
    expect(dom.document.getElementById(activeControls() ?? "")).not.toBeNull();

    setTitle("Workspace");
    setIcon("ti ti-layout");
    expect(tabs()[0]?.textContent).toContain("Workspace");
    expect(tabs()[0]?.querySelector("i")?.className).toContain("ti-layout");
    expect(dom.root.querySelector("h2")?.textContent).toBe("Workspace");

    tabs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tabs()[0]?.hasAttribute("aria-controls")).toBe(false);
    expect(tabs()[1]?.getAttribute("aria-controls")).toBeTruthy();
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
