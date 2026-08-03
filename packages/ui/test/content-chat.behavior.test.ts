import { describe, expect, test } from "bun:test";
import { createComponent, createSignal } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "./dom";

describe("@k2b/ui content and chat behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("keeps nested DataTable controls independent from the row action", async () => {
    const dom = createDomTestHarness();
    const { default: DataTable } = await import("../src/content/DataTable");
    const rowClicks: string[] = [];
    const rowDoubleClicks: string[] = [];
    let controlClicks = 0;

    const dispose = render(
      () =>
        createComponent(DataTable<{ id: string; name: string }>, {
          rows: [{ id: "one", name: "Ada" }],
          columns: [{ id: "name", header: "Name", value: "name" }],
          getRowId: (row) => row.id,
          onRowClick: (row) => rowClicks.push(row.id),
          onRowDoubleClick: (row) => rowDoubleClicks.push(row.id),
          renderCell: () => {
            const button = dom.document.createElement("button");
            button.type = "button";
            button.textContent = "Open actions";
            button.addEventListener("click", () => {
              controlClicks += 1;
            });
            return button as unknown as HTMLElement;
          },
        }),
      dom.root,
    );

    const row = dom.root.querySelector<HTMLTableRowElement>("tbody tr");
    const cell = dom.root.querySelector<HTMLTableCellElement>("tbody td");
    const button = dom.root.querySelector<HTMLButtonElement>("tbody button");

    button?.click();
    expect(controlClicks).toBe(1);
    expect(rowClicks).toEqual([]);

    const nestedDoubleClick = new MouseEvent("dblclick", { bubbles: true });
    button?.dispatchEvent(nestedDoubleClick);
    expect(rowDoubleClicks).toEqual([]);

    const nestedEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    const nestedSpace = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    button?.dispatchEvent(nestedEnter);
    button?.dispatchEvent(nestedSpace);
    expect(rowClicks).toEqual([]);
    expect(nestedEnter.defaultPrevented).toBe(false);
    expect(nestedSpace.defaultPrevented).toBe(false);

    cell?.click();
    expect(rowClicks).toEqual(["one"]);

    row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(rowDoubleClicks).toEqual(["one"]);

    const rowEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    row?.dispatchEvent(rowEnter);
    expect(rowClicks).toEqual(["one", "one"]);
    expect(rowEnter.defaultPrevented).toBe(true);
    expect(row?.getAttribute("tabindex")).toBe("0");

    dispose();
    dom.cleanup();
  });

  test("names the focusable ChatTimeline viewport as a scroll region", async () => {
    const dom = createDomTestHarness();
    const { Chat } = await import("../src/chat");

    const dispose = render(
      () =>
        createComponent(Chat.Timeline, {
          label: "Support conversation",
          items: [{ kind: "message", id: "one", role: "user", content: "Hello" }],
        }),
      dom.root,
    );

    const viewport = dom.root.querySelector<HTMLElement>(".k2b-chat-timeline__viewport");
    expect(viewport?.getAttribute("role")).toBe("region");
    expect(viewport?.getAttribute("aria-label")).toBe("Support conversation messages");
    expect(viewport?.getAttribute("tabindex")).toBe("0");

    dispose();
    dom.cleanup();
  });

  test("restores composer focus after a run without stealing another editor", async () => {
    const dom = createDomTestHarness();
    const { Chat } = await import("../src/chat");
    const [running, setRunning] = createSignal(true);
    const externalInput = dom.document.createElement("input");
    dom.document.body.append(externalInput);

    const dispose = render(
      () =>
        createComponent(Chat.Composer, {
          value: "",
          onValueChange: () => undefined,
          onSubmit: () => undefined,
          get state() {
            return running() ? "running" : "idle";
          },
        }),
      dom.root,
    );
    const composerInput = dom.root.querySelector<HTMLTextAreaElement>("textarea");

    setRunning(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dom.document.activeElement).toBe(composerInput);

    setRunning(true);
    externalInput.focus();
    setRunning(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dom.document.activeElement).toBe(externalInput);

    dispose();
    externalInput.remove();
    dom.cleanup();
  });

  test("replaces stop with steer as soon as the user types during a run", async () => {
    const dom = createDomTestHarness();
    const { Chat } = await import("../src/chat");
    const [draft, setDraft] = createSignal("");

    const dispose = render(
      () =>
        createComponent(Chat.Composer, {
          get value() {
            return draft();
          },
          onValueChange: setDraft,
          onSubmit: () => undefined,
          onStop: () => undefined,
          state: "running",
        }),
      dom.root,
    );

    expect(dom.root.querySelector('[aria-label="Stop response"]')).not.toBeNull();
    expect(dom.root.querySelector('[aria-label="Steer response"]')).toBeNull();

    setDraft("One more detail");
    await Promise.resolve();

    expect(dom.root.querySelector('[aria-label="Stop response"]')).toBeNull();
    expect(dom.root.querySelector('[aria-label="Steer response"]')).not.toBeNull();

    dispose();
    dom.cleanup();
  });
});
