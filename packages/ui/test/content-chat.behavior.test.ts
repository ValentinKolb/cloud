import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
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
    const { ChatTimeline } = await import("../src/chat/ChatTimeline");

    const dispose = render(
      () =>
        createComponent(ChatTimeline, {
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
});
