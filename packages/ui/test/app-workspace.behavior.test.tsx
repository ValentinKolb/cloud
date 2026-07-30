import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "./dom";

describe("@k2b/ui AppWorkspace behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("keeps sidebar active state and aria-current reactive", async () => {
    const dom = createDomTestHarness();
    const { default: AppWorkspace } = await import("../src/layout/AppWorkspace");
    const [active, setActive] = createSignal<"items" | "recent">("items");
    const dispose = render(
      () => (
        <div>
          <AppWorkspace.SidebarItem
            href="/items"
            navigation="document"
            active={active() === "items"}
          >
            Items
          </AppWorkspace.SidebarItem>
          <AppWorkspace.SidebarItem
            href="/recent"
            navigation="document"
            active={active() === "recent"}
          >
            Recent
          </AppWorkspace.SidebarItem>
          <AppWorkspace.SidebarIconAction
            icon="ti ti-history"
            label="Recent rail"
            active={active() === "recent"}
          />
        </div>
      ),
      dom.root,
    );

    const items = dom.root.querySelector<HTMLAnchorElement>('a[href="/items"]');
    const recent = dom.root.querySelector<HTMLAnchorElement>('a[href="/recent"]');
    const rail = dom.root.querySelector<HTMLButtonElement>('[aria-label="Recent rail"]');
    expect(items?.classList.contains("is-active")).toBe(true);
    expect(items?.getAttribute("aria-current")).toBe("page");
    expect(recent?.classList.contains("is-active")).toBe(false);
    expect(recent?.getAttribute("aria-current")).toBeNull();
    expect(rail?.classList.contains("is-active")).toBe(false);

    setActive("recent");
    expect(items?.classList.contains("is-active")).toBe(false);
    expect(items?.getAttribute("aria-current")).toBeNull();
    expect(recent?.classList.contains("is-active")).toBe(true);
    expect(recent?.getAttribute("aria-current")).toBe("page");
    expect(rail?.classList.contains("is-active")).toBe(true);

    dispose();
    dom.cleanup();
  });
});
