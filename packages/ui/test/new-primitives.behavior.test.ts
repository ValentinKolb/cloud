import { describe, expect, test } from "bun:test";
import { type Component, createComponent, createSignal } from "solid-js";
import { isServer, render } from "solid-js/web";
import type { TagEditorItem, TagEditorProps, TagEditorValue } from "../src/inputs/TagEditor";
import { createDomTestHarness } from "./dom";

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("@k2b/ui new primitive behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("keeps a mixed checkbox synchronized with its native control", async () => {
    const dom = createDomTestHarness();
    const { Checkbox } = await import("../src/inputs/Checkbox");
    let setMixed: (value: boolean) => void = () => {};

    const dispose = render(() => {
      const [mixed, updateMixed] = createSignal(true);
      setMixed = updateMixed;
      return createComponent(Checkbox, {
        "aria-label": "Select visible records",
        value: false,
        get indeterminate() {
          return mixed();
        },
      });
    }, dom.root);

    const input = dom.root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input?.indeterminate).toBe(true);
    expect(input?.getAttribute("aria-checked")).toBe("mixed");

    setMixed(false);
    await flush();

    expect(input?.indeterminate).toBe(false);
    expect(input?.getAttribute("aria-checked")).toBe("false");

    dispose();
    dom.cleanup();
  });

  test("moves tabs with the keyboard and skips disabled options", async () => {
    const dom = createDomTestHarness();
    const { Tabs } = await import("../src/actions/Tabs");

    const dispose = render(() => {
      const [value, setValue] = createSignal("overview");
      return createComponent(Tabs, {
        ariaLabel: "Project sections",
        value,
        onValueChange: setValue,
        options: [
          { value: "overview", label: "Overview", panel: "Overview panel" },
          { value: "disabled", label: "Disabled", disabled: true },
          { value: "activity", label: "Activity", panel: "Activity panel" },
        ],
      });
    }, dom.root);

    const tabs = Array.from(dom.root.querySelectorAll<HTMLButtonElement>("[role='tab']"));
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);

    tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();

    expect(tabs[2]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[2]?.tabIndex).toBe(0);
    expect(dom.root.querySelector("[role='tabpanel']")?.textContent).toContain("Activity panel");

    dispose();
    dom.cleanup();
  });

  test("supports uncontrolled disclosure state through the native toggle event", async () => {
    const dom = createDomTestHarness();
    const { Disclosure } = await import("../src/actions/Disclosure");
    const changes: boolean[] = [];
    const dispose = render(
      () =>
        createComponent(Disclosure, {
          summary: "Advanced options",
          children: "Details",
          onValueChange: (value) => changes.push(value),
        }),
      dom.root,
    );

    const details = dom.root.querySelector<HTMLDetailsElement>("details");
    if (details) {
      details.open = true;
    }
    await flush();

    expect(changes).toEqual([true]);
    expect(details?.open).toBe(true);

    dispose();
    dom.cleanup();
  });

  test("does not echo controlled disclosure updates back to the owner", async () => {
    const dom = createDomTestHarness();
    const { Disclosure } = await import("../src/actions/Disclosure");
    const changes: boolean[] = [];
    let setOpen: (value: boolean) => void = () => {};
    const dispose = render(() => {
      const [open, updateOpen] = createSignal(false);
      setOpen = updateOpen;
      return createComponent(Disclosure, {
        summary: "Advanced options",
        children: "Details",
        value: open,
        onValueChange: (value) => changes.push(value),
      });
    }, dom.root);

    setOpen(true);
    await flush();

    expect(dom.root.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);
    expect(changes).toEqual([]);

    dispose();
    dom.cleanup();
  });

  test("creates, updates, and removes tags through application callbacks", async () => {
    const dom = createDomTestHarness();
    const { TagEditor } = await import("../src/inputs/TagEditor");
    const created: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const dirty: boolean[] = [];
    const item = { id: "design", name: "Design", color: "#2563eb" };

    const dispose = render(
      () =>
        createComponent(TagEditor as Component<TagEditorProps>, {
          items: [item],
          onCreate: (value: TagEditorValue) => {
            created.push(value.name);
          },
          onUpdate: (_item: TagEditorItem, value: TagEditorValue) => {
            updated.push(value.name);
          },
          onDelete: (value: TagEditorItem) => {
            removed.push(value.id);
          },
          onDirtyChange: (value: boolean) => dirty.push(value),
        }),
      dom.root,
    );

    Array.from(dom.root.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Add tag"))
      ?.click();
    const createForm = dom.root.querySelector<HTMLFormElement>(".k2b-tag-editor__form");
    const createName = createForm?.querySelector<HTMLInputElement>('input[type="text"]');
    if (createName) {
      createName.value = "Platform";
      createName.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await flush();
    expect(dirty.at(-1)).toBe(true);
    createForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(created).toEqual(["Platform"]);
    expect(dirty.at(-1)).toBe(false);

    dom.root.querySelector<HTMLButtonElement>('[aria-label="Edit Design"]')?.click();
    const updateForm = dom.root.querySelector<HTMLFormElement>(".k2b-tag-editor__form");
    const updateName = updateForm?.querySelector<HTMLInputElement>('input[type="text"]');
    if (updateName) {
      updateName.value = "Product design";
      updateName.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await flush();
    expect(dirty.at(-1)).toBe(true);
    updateForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(updated).toEqual(["Product design"]);
    expect(dirty.at(-1)).toBe(false);

    dom.root.querySelector<HTMLButtonElement>('[aria-label="Delete Design"]')?.click();
    await flush();
    expect(removed).toEqual(["design"]);

    dispose();
    dom.cleanup();
  });
});
