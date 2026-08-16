import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "./dom";

describe("@k2b/ui Calendar month drag behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("keeps a crowded target day within its existing event stack while dragging", async () => {
    const dom = createDomTestHarness();
    const { default: Calendar } = await import("../src/content/Calendar");
    const dispose = render(
      () =>
        createComponent(Calendar, {
          date: "2026-08-12T12:00:00Z",
          view: "month",
          timeZone: "UTC",
          events: [
            { id: "dragged", title: "Design review", start: "2026-08-05T09:00:00Z", end: "2026-08-05T10:00:00Z" },
            { id: "one", title: "Launch checklist", start: "2026-08-12T09:00:00Z", end: "2026-08-12T10:00:00Z" },
            { id: "two", title: "Product launch", start: "2026-08-12T10:00:00Z", end: "2026-08-12T11:00:00Z" },
            { id: "three", title: "Team stand-up", start: "2026-08-12T11:00:00Z", end: "2026-08-12T12:00:00Z" },
            { id: "four", title: "Partner call", start: "2026-08-12T12:00:00Z", end: "2026-08-12T13:00:00Z" },
          ],
          onEventDrop: () => {},
        }),
      dom.root,
    );

    const source = Array.from(dom.root.querySelectorAll<HTMLElement>("[data-calendar-event]")).find((event) =>
      event.textContent?.includes("Design review"),
    );
    const target = dom.root.querySelector<HTMLElement>('[data-calendar-day-key="2026-08-12"]');
    expect(source).toBeDefined();
    expect(target).not.toBeNull();
    expect(target?.querySelector(".k2b-calendar-month__events")?.children).toHaveLength(4);
    Object.defineProperty(dom.document, "elementFromPoint", { configurable: true, value: () => target });

    source?.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 0,
        clientY: 0,
        isPrimary: true,
        pointerId: 1,
        pointerType: "mouse",
      }) as unknown as Event,
    );
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
        isPrimary: true,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );

    const stack = target?.querySelector(".k2b-calendar-month__events");
    expect(stack?.children).toHaveLength(4);
    expect(stack?.querySelectorAll(".k2b-calendar-preview")).toHaveLength(1);
    expect(stack?.querySelectorAll("[data-calendar-event]")).toHaveLength(2);
    expect(stack?.querySelector(".k2b-calendar-month__more")?.textContent).toContain("+2 more");

    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointercancel", { bubbles: true, isPrimary: true, pointerId: 1, pointerType: "mouse" }),
    );
    dispose();
    dom.cleanup();
  });
});
