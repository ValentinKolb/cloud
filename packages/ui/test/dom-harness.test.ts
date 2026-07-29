import { describe, expect, test } from "bun:test";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "./dom";

describe("@k2b/ui DOM test harness", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("mounts, handles events, reacts, and disposes", () => {
    const dom = createDomTestHarness();
    let cleanupCalls = 0;

    const dispose = render(() => {
      const [count, setCount] = createSignal(0);
      const button = dom.document.createElement("button");
      const onClick = () => setCount((value) => value + 1);

      button.addEventListener("click", onClick);
      createEffect(() => {
        button.textContent = `Count ${count()}`;
      });
      onCleanup(() => {
        cleanupCalls += 1;
        button.removeEventListener("click", onClick);
      });

      return button;
    }, dom.root);

    const button = dom.root.querySelector("button");
    expect(button?.textContent).toBe("Count 0");

    button?.click();
    expect(button?.textContent).toBe("Count 1");

    dispose();
    expect(cleanupCalls).toBe(1);
    expect(dom.root.childElementCount).toBe(0);

    dom.cleanup();
    expect(globalThis.document).toBeUndefined();
  });

  test("renders, updates, and dismisses a toast in the browser", async () => {
    const dom = createDomTestHarness();
    const { K2B_TOAST_CONTAINER_ID, toast } = await import("../src/feedback/toast");

    const handle = toast.success("Saved", { duration: 0 });
    const container = dom.document.getElementById(K2B_TOAST_CONTAINER_ID);
    const renderedToast = container?.querySelector<HTMLElement>("[data-k2b-toast]");

    expect(renderedToast?.dataset.tone).toBe("success");
    expect(renderedToast?.textContent).toContain("Saved");

    handle.update("Published", { variant: "error", duration: 0 });
    expect(renderedToast?.dataset.tone).toBe("danger");
    expect(renderedToast?.textContent).toContain("Published");

    handle.dismiss();
    expect(renderedToast?.dataset.closing).toBe("true");
    await Bun.sleep(220);
    expect(container?.childElementCount).toBe(0);

    dom.cleanup();
  });
});
