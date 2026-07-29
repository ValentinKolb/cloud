import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness, type DomTestHarness } from "./dom";

type PopoverPatch = {
  restore: () => void;
};

const installPopoverApi = (dom: DomTestHarness): PopoverPatch => {
  const prototype = dom.window.HTMLElement.prototype as unknown as HTMLElement;
  const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const open = new WeakSet<Element>();

  const patch = (key: PropertyKey, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(prototype, key));
    Object.defineProperty(prototype, key, { configurable: true, writable: true, value });
  };

  const matches = prototype.matches;
  patch("matches", function (this: Element, selector: string) {
    return selector === ":popover-open" ? open.has(this) : matches.call(this, selector);
  });
  patch("showPopover", function (this: HTMLElement) {
    open.add(this);
  });
  patch("hidePopover", function (this: HTMLElement) {
    open.delete(this);
  });
  patch("scrollIntoView", () => {});

  return {
    restore: () => {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(prototype, key, descriptor);
        else Reflect.deleteProperty(prototype, key);
      }
    },
  };
};

describe("@k2b/ui choice and date browser behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("registers choice listeners only while open and clears a failed active option", async () => {
    const dom = createDomTestHarness();
    const popover = installPopoverApi(dom);
    const { Combobox } = await import("../src/inputs/Combobox");
    const activeListeners = { pointerdown: 0, resize: 0, scroll: 0 };
    type ListenerTarget = {
      addEventListener: (...args: unknown[]) => unknown;
      removeEventListener: (...args: unknown[]) => unknown;
    };
    const documentTarget = dom.document as unknown as ListenerTarget;
    const windowTarget = dom.window as unknown as ListenerTarget;
    const documentAdd = documentTarget.addEventListener.bind(dom.document);
    const documentRemove = documentTarget.removeEventListener.bind(dom.document);
    const windowAdd = windowTarget.addEventListener.bind(dom.window);
    const windowRemove = windowTarget.removeEventListener.bind(dom.window);

    documentTarget.addEventListener = (...args) => {
      if (args[0] === "pointerdown") activeListeners.pointerdown += 1;
      return documentAdd(...args);
    };
    documentTarget.removeEventListener = (...args) => {
      if (args[0] === "pointerdown") activeListeners.pointerdown -= 1;
      return documentRemove(...args);
    };
    windowTarget.addEventListener = (...args) => {
      if (args[0] === "resize" || args[0] === "scroll") activeListeners[args[0]] += 1;
      return windowAdd(...args);
    };
    windowTarget.removeEventListener = (...args) => {
      if (args[0] === "resize" || args[0] === "scroll") activeListeners[args[0]] -= 1;
      return windowRemove(...args);
    };

    const dispose = render(
      () =>
        createComponent(Combobox, {
          label: "Add team",
          debounceMs: 0,
          fetchData: async (query) => {
            if (query === "broken") throw new Error("Could not load teams");
            return [{ id: "platform", label: "Platform" }];
          },
          onSelect: () => {},
        }),
      dom.root,
    );

    const input = dom.root.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(input?.getAttribute("aria-labelledby")).toBe(`${input?.id}-label`);
    expect(activeListeners).toEqual({ pointerdown: 0, resize: 0, scroll: 0 });

    input?.focus();
    await Bun.sleep(0);
    expect(activeListeners).toEqual({ pointerdown: 1, resize: 1, scroll: 1 });

    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const activeId = input?.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(dom.document.getElementById(activeId ?? "")?.textContent).toContain("Platform");

    if (input) {
      input.value = "broken";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await Bun.sleep(0);

    expect(input?.hasAttribute("aria-activedescendant")).toBe(false);
    expect(dom.root.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(dom.root.textContent).toContain("Could not load teams");

    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(activeListeners).toEqual({ pointerdown: 0, resize: 0, scroll: 0 });

    dispose();
    popover.restore();
    dom.cleanup();
  });

  test("loads the controlled query when the combobox opens", async () => {
    const dom = createDomTestHarness();
    const popover = installPopoverApi(dom);
    const { Combobox } = await import("../src/inputs/Combobox");
    const queries: string[] = [];
    const dispose = render(
      () =>
        createComponent(Combobox, {
          label: "Add team",
          query: "platform",
          debounceMs: 0,
          fetchData: async (query) => {
            queries.push(query);
            return [{ id: query, label: query }];
          },
          onSelect: () => {},
        }),
      dom.root,
    );

    dom.root.querySelector<HTMLInputElement>('[role="combobox"]')?.focus();
    await Bun.sleep(0);

    expect(queries).toEqual(["platform"]);
    expect(dom.root.querySelector('[role="option"]')?.textContent).toContain("platform");

    dispose();
    popover.restore();
    dom.cleanup();
  });

  test("keeps focus on the next day across a month boundary", async () => {
    const dom = createDomTestHarness();
    const popover = installPopoverApi(dom);
    const { DatePicker } = await import("../src/inputs/DatePicker");
    const dispose = render(
      () =>
        createComponent(DatePicker, {
          label: "Release date",
          value: "2026-07-31",
          dateConfig: { locale: "en", timeZone: "UTC" },
        }),
      dom.root,
    );

    dom.root.querySelector<HTMLButtonElement>(".k2b-date-trigger")?.click();
    await Bun.sleep(0);

    const july31 = dom.root.querySelector<HTMLButtonElement>('[data-date-day="2026-07-31"]');
    july31?.focus();
    july31?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await Bun.sleep(0);

    const august1 = dom.root.querySelector<HTMLButtonElement>('[data-date-day="2026-08-01"]');
    expect(dom.document.activeElement).toBe(august1);
    expect(august1?.getAttribute("aria-label")).toContain("Saturday");
    expect(august1?.getAttribute("aria-label")).toContain("August");
    expect(august1?.getAttribute("aria-label")).toContain("2026");

    dispose();
    popover.restore();
    dom.cleanup();
  }, 10_000);

  test("names the PIN group from its visible field label", async () => {
    const dom = createDomTestHarness();
    const { PinInput } = await import("../src/inputs/ChoiceInputs");
    const dispose = render(() => createComponent(PinInput, { label: "Security code", length: 4 }), dom.root);

    const group = dom.root.querySelector<HTMLElement>('[role="group"]');
    const labelId = group?.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(dom.document.getElementById(labelId ?? "")?.textContent).toContain("Security code");
    expect(group?.querySelectorAll("input")).toHaveLength(4);

    dispose();
    dom.cleanup();
  });
});
