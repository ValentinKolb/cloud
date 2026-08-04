import { describe, expect, spyOn, test } from "bun:test";
import { createComponent, createSignal, type JSX } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "./dom";

const flush = async (): Promise<void> => {
  await Promise.resolve();
};

const installPopoverStub = (): void => {
  const openPopovers = new WeakSet<HTMLElement>();
  const prototype = HTMLElement.prototype as typeof HTMLElement.prototype & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  const matches = prototype.matches;
  const dispatchToggle = (element: HTMLElement, oldState: "closed" | "open", newState: "closed" | "open") => {
    const event = new Event("toggle");
    Object.defineProperties(event, {
      oldState: { value: oldState },
      newState: { value: newState },
    });
    element.dispatchEvent(event);
  };

  prototype.matches = function (selector: string): boolean {
    return selector === ":popover-open" ? openPopovers.has(this) : matches.call(this, selector);
  };
  prototype.showPopover = function (): void {
    if (openPopovers.has(this)) return;
    openPopovers.add(this);
    dispatchToggle(this, "closed", "open");
  };
  prototype.hidePopover = function (): void {
    if (!openPopovers.delete(this)) return;
    dispatchToggle(this, "open", "closed");
  };
};

const buttonElement = (document: Document, text: string, id?: string, tabIndex?: number): JSX.Element => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (id) button.id = id;
  if (tabIndex !== undefined) button.tabIndex = tabIndex;
  return button as unknown as JSX.Element;
};

describe("@k2b/ui action runtime behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("scopes dropdown viewport listeners, preserves custom content, and reacts to disabled", async () => {
    const dom = createDomTestHarness();
    installPopoverStub();
    const { Dropdown } = await import("../src/actions/Dropdown");
    const addListener = spyOn(window, "addEventListener");
    const removeListener = spyOn(window, "removeEventListener");
    let setDisabled: (disabled: boolean) => void = () => {};
    let openDuringAction: boolean | undefined;

    const dispose = render(() => {
      const [disabled, updateDisabled] = createSignal(false);
      setDisabled = updateDisabled;
      return createComponent(Dropdown, {
        get disabled() {
          return disabled();
        },
        label: "Project actions",
        trigger: buttonElement(dom.document, "Open"),
        elements: [
          {
            element: buttonElement(dom.document, "Consumer action", "consumer-action", 5),
          },
          {
            label: "Rename",
            action: () => {
              openDuringAction = dom.root.querySelector<HTMLElement>(".k2b-dropdown__menu")?.matches(":popover-open");
            },
          },
        ],
      });
    }, dom.root);

    const trigger = dom.root.querySelector<HTMLButtonElement>(".k2b-dropdown__trigger > button");
    expect(trigger?.getAttribute("aria-disabled")).toBe("false");
    expect(trigger?.hasAttribute("tabindex")).toBe(false);
    expect(addListener.mock.calls.some(([type]) => type === "scroll" || type === "resize")).toBe(false);

    trigger?.click();
    await flush();
    expect(addListener.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1);
    expect(addListener.mock.calls.filter(([type]) => type === "resize")).toHaveLength(1);

    const custom = dom.root.querySelector<HTMLButtonElement>("#consumer-action");
    expect(custom?.getAttribute("role")).toBeNull();
    expect(custom?.tabIndex).toBe(5);

    dom.root.querySelectorAll<HTMLButtonElement>("[role='menuitem']")[0]?.click();
    await flush();
    expect(openDuringAction).toBe(false);
    expect(removeListener.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1);
    expect(removeListener.mock.calls.filter(([type]) => type === "resize")).toHaveLength(1);

    setDisabled(true);
    expect(trigger?.disabled).toBe(true);
    expect(trigger?.tabIndex).toBe(-1);
    expect(trigger?.getAttribute("aria-disabled")).toBe("true");

    setDisabled(false);
    expect(trigger?.disabled).toBe(false);
    expect(trigger?.hasAttribute("tabindex")).toBe(false);
    expect(trigger?.getAttribute("aria-disabled")).toBe("false");

    dispose();
    addListener.mockRestore();
    removeListener.mockRestore();
    dom.cleanup();
  });

  test("switches a DropdownItem reactively between a disabled button and link", async () => {
    const dom = createDomTestHarness();
    const { DropdownItem } = await import("../src/actions/Dropdown");
    let setDisabled: (disabled: boolean) => void = () => {};
    let setHref: (href: string | undefined) => void = () => {};

    const dispose = render(() => {
      const [disabled, updateDisabled] = createSignal(false);
      const [href, updateHref] = createSignal<string | undefined>("/docs");
      setDisabled = updateDisabled;
      setHref = updateHref;
      return createComponent(DropdownItem, {
        get disabled() {
          return disabled();
        },
        get href() {
          return href();
        },
        children: "Documentation",
      });
    }, dom.root);

    expect(dom.root.querySelector("a")?.getAttribute("href")).toBe("/docs");
    setDisabled(true);
    expect(dom.root.querySelector("a")).toBeNull();
    expect(dom.root.querySelector("button")?.disabled).toBe(true);

    setDisabled(false);
    expect(dom.root.querySelector("a")?.getAttribute("href")).toBe("/docs");
    setHref(undefined);
    expect(dom.root.querySelector("a")).toBeNull();
    expect(dom.root.querySelector("button")?.disabled).toBe(false);

    dispose();
    dom.cleanup();
  });

  test("keeps embedded form controls in the open dropdown Tab flow", async () => {
    const dom = createDomTestHarness();
    installPopoverStub();
    const { Dropdown } = await import("../src/actions/Dropdown");
    const form = dom.document.createElement("form");
    const input = dom.document.createElement("input");
    const save = dom.document.createElement("button");
    input.name = "name";
    save.type = "button";
    save.textContent = "Save";
    form.append(input, save);

    const dispose = render(
      () =>
        createComponent(Dropdown, {
          label: "Edit project",
          trigger: buttonElement(dom.document, "Edit"),
          elements: [{ element: form as unknown as JSX.Element }],
        }),
      dom.root,
    );

    const trigger = dom.root.querySelector<HTMLButtonElement>(".k2b-dropdown__trigger > button");
    trigger?.click();
    await flush();

    const menu = dom.root.querySelector<HTMLElement>(".k2b-dropdown__menu");
    const menuKeyDown = (menu as unknown as { $$keydown?: (event: KeyboardEvent) => void })?.$$keydown;
    const tab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    Object.defineProperty(tab, "target", { value: input });
    menuKeyDown?.(tab);

    expect(tab.defaultPrevented).toBe(false);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(input.tabIndex).toBe(0);
    expect(save.tabIndex).toBe(0);
    expect(save.getAttribute("role")).toBeNull();
    save.focus();
    expect(dom.document.activeElement).toBe(save as unknown as Element);

    dispose();
    dom.cleanup();
  });

  test("keeps FilterChip option identity and exposes live checkbox and radio state", async () => {
    const dom = createDomTestHarness();
    installPopoverStub();
    const { FilterChip } = await import("../src/actions/FilterChip");
    const changes: string[][] = [];
    let acceptChanges = false;

    const dispose = render(() => {
      const [value, setValue] = createSignal<readonly string[]>([]);
      return createComponent(FilterChip, {
        label: "State",
        icon: "ti ti-filter",
        get value() {
          return value();
        },
        onValueChange: (nextValue) => {
          changes.push(nextValue);
          if (acceptChanges) setValue(nextValue);
        },
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
            options: [{ value: "urgent", label: "Urgent" }],
          },
        ],
      });
    }, dom.root);

    dom.root.querySelector<HTMLElement>(".k2b-filter-chip")?.click();
    await flush();

    const radio = dom.root.querySelector<HTMLButtonElement>("[role='menuitemradio']");
    const checkbox = dom.root.querySelector<HTMLButtonElement>("[role='menuitemcheckbox']");
    expect(radio?.getAttribute("aria-checked")).toBe("false");
    expect(checkbox?.getAttribute("aria-checked")).toBe("false");
    expect(checkbox?.querySelector("input")).toBeNull();

    checkbox?.focus();
    const originalCheckbox = checkbox;
    checkbox?.click();
    expect(changes).toEqual([["urgent"]]);
    expect(dom.document.activeElement).toBe(originalCheckbox);
    expect(dom.root.querySelector("[role='menuitemcheckbox']")).toBe(originalCheckbox);
    expect(originalCheckbox?.getAttribute("aria-checked")).toBe("false");

    acceptChanges = true;
    originalCheckbox?.click();
    expect(changes).toEqual([["urgent"], ["urgent"]]);
    expect(originalCheckbox?.getAttribute("aria-checked")).toBe("true");

    const menu = dom.root.querySelector<HTMLElement>(".k2b-dropdown__menu");
    const menuKeyDown = (menu as unknown as { $$keydown?: (event: KeyboardEvent) => void })?.$$keydown;
    expect(menuKeyDown).toBeFunction();
    menuKeyDown?.(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    expect(dom.document.activeElement).toBe(dom.root.querySelectorAll("[role='menuitemradio']")[1] ?? null);

    originalCheckbox?.focus();
    originalCheckbox?.click();
    expect(changes).toEqual([["urgent"], ["urgent"], []]);
    expect(dom.document.activeElement).toBe(originalCheckbox);
    expect(originalCheckbox?.getAttribute("aria-checked")).toBe("false");

    dispose();
    dom.cleanup();
  });

  test("exposes SelectChip selection as a radio menu without rebuilding its rows", async () => {
    const dom = createDomTestHarness();
    installPopoverStub();
    const { SelectChip } = await import("../src/inputs/SelectChip");
    let setValue: (value: string) => void = () => {};
    let openDuringChange: boolean | undefined;

    const dispose = render(() => {
      const [value, updateValue] = createSignal("comfortable");
      setValue = updateValue;
      return createComponent(SelectChip, {
        "aria-label": "Density",
        value,
        onValueChange: (nextValue: string) => {
          openDuringChange = dom.root.querySelector<HTMLElement>(".k2b-dropdown__menu")?.matches(":popover-open");
          updateValue(nextValue);
        },
        options: [
          { value: "compact", label: "Compact" },
          { value: "comfortable", label: "Comfortable" },
          { value: "disabled", label: "Disabled", disabled: true },
        ],
      });
    }, dom.root);

    dom.root.querySelector<HTMLButtonElement>(".k2b-select-chip")?.click();
    await flush();
    const options = Array.from(dom.root.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']"));
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(options[2]?.disabled).toBe(true);

    const compact = options[0];
    compact?.focus();
    setValue("compact");
    expect(dom.root.querySelectorAll("[role='menuitemradio']")[0]).toBe(compact);
    expect(compact?.getAttribute("aria-checked")).toBe("true");

    options[1]?.click();

    expect(openDuringChange).toBe(false);
    expect(dom.root.querySelector(".k2b-select-chip")?.getAttribute("aria-expanded")).toBe("false");

    dispose();
    dom.cleanup();
  });

  test("attaches ContextMenu globals only while open and ignores menu scroll", async () => {
    const dom = createDomTestHarness();
    const extraGlobals = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of [
      ["DOMRect", dom.window.DOMRect],
      ["HTMLHeadElement", dom.window.HTMLHeadElement],
    ] as const) {
      extraGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value,
      });
    }
    const { ContextMenu } = await import("../src/actions/ContextMenu");
    const windowAdd = spyOn(window, "addEventListener");
    const windowRemove = spyOn(window, "removeEventListener");
    const documentAdd = spyOn(document, "addEventListener");
    const documentRemove = spyOn(document, "removeEventListener");

    const dispose = render(
      () =>
        createComponent(ContextMenu, {
          label: "File actions",
          elements: [
            {
              element: buttonElement(dom.document, "Custom", "custom-context-action", 4),
            },
            { label: "Rename", action: () => {} },
          ],
          children: "README.md",
        }),
      dom.root,
    );

    const host = dom.root.querySelector<HTMLElement>("[role='group']");
    expect(host?.getAttribute("aria-label")).toBe("File actions");
    expect(host?.getAttribute("aria-haspopup")).toBe("menu");
    expect(host?.getAttribute("aria-expanded")).toBe("false");
    expect(windowAdd.mock.calls.some(([type]) => type === "scroll" || type === "resize")).toBe(false);
    expect(documentAdd.mock.calls.some(([type]) => type === "pointerdown")).toBe(false);

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: 24,
      clientY: 32,
    });
    const contextMenuHandler = (host as unknown as { $$contextmenu?: (event: MouseEvent) => void })?.$$contextmenu;
    expect(contextMenuHandler).toBeFunction();
    contextMenuHandler?.(contextMenuEvent);
    await flush();

    const menuId = host?.getAttribute("aria-controls");
    const menu = menuId ? dom.document.getElementById(menuId) : null;
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(host?.getAttribute("aria-expanded")).toBe("true");
    expect(windowAdd.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1);
    expect(windowAdd.mock.calls.filter(([type]) => type === "resize")).toHaveLength(1);
    expect(documentAdd.mock.calls.filter(([type]) => type === "pointerdown")).toHaveLength(1);

    const custom = dom.document.getElementById("custom-context-action") as HTMLButtonElement | null;
    expect(custom?.getAttribute("role")).toBeNull();
    expect(custom?.tabIndex).toBe(4);

    menu?.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(host?.getAttribute("aria-expanded")).toBe("true");
    expect(dom.document.getElementById(menuId ?? "")).toBe(menu);

    window.dispatchEvent(new Event("scroll"));
    expect(host?.getAttribute("aria-expanded")).toBe("false");
    expect(windowRemove.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1);
    expect(windowRemove.mock.calls.filter(([type]) => type === "resize")).toHaveLength(1);
    expect(documentRemove.mock.calls.filter(([type]) => type === "pointerdown")).toHaveLength(1);

    dispose();
    windowAdd.mockRestore();
    windowRemove.mockRestore();
    documentAdd.mockRestore();
    documentRemove.mockRestore();
    for (const [name, descriptor] of extraGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    dom.cleanup();
  });
});
