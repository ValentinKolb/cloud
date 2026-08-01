import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "./dom";

describe("@k2b/ui AppWorkspace.NavTree behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  test("keeps state, depth, and keyboard focus controlled", async () => {
    const dom = createDomTestHarness();
    const { default: AppWorkspace } = await import("../src/layout/AppWorkspace");
    const [selectedId, setSelectedId] = createSignal("notes");
    const [expandedIds, setExpandedIds] = createSignal<readonly string[]>(["notes", "tags"]);
    const dispose = render(
      () => (
        <>
          <AppWorkspace.NavTree
            ariaLabel="Notebook navigation"
            selectedId={selectedId()}
            expandedIds={expandedIds()}
            onSelectedIdChange={setSelectedId}
            onExpandedIdsChange={setExpandedIds}
          >
            <AppWorkspace.NavTree.Item id="notes" label="All notes" icon="ti ti-folder">
              <AppWorkspace.NavTree.Item id="recipes" label="Recipes" icon="ti ti-folder" />
            </AppWorkspace.NavTree.Item>
            <AppWorkspace.NavTree.Item id="tags" label="Tags" icon="ti ti-tags">
              <AppWorkspace.NavTree.Item id="recipe-tag" label="#recipe" icon="ti ti-tag" meta={3} />
            </AppWorkspace.NavTree.Item>
          </AppWorkspace.NavTree>
          <AppWorkspace.NavTree ariaLabel="Uncontrolled groups" defaultExpandedIds={["group"]}>
            <AppWorkspace.NavTree.Item id="group" label="Group" icon="ti ti-folders">
              <AppWorkspace.NavTree.Item id="group-child" label="Child" />
            </AppWorkspace.NavTree.Item>
          </AppWorkspace.NavTree>
        </>
      ),
      dom.root,
    );

    const notes = () => dom.root.querySelector<HTMLElement>('[data-k2b-nav-tree-id="notes"]');
    const recipes = () => dom.root.querySelector<HTMLElement>('[data-k2b-nav-tree-id="recipes"]');
    const tags = () => dom.root.querySelector<HTMLElement>('[data-k2b-nav-tree-id="tags"]');
    expect(dom.root.querySelector('[role="tree"]')?.getAttribute("aria-label")).toBe("Notebook navigation");
    expect(notes()?.getAttribute("aria-expanded")).toBe("true");
    expect(recipes()?.getAttribute("aria-level")).toBe("2");
    expect(
      recipes()?.querySelector<HTMLElement>(".k2b-app-workspace__nav-tree-row")?.style.getPropertyValue("--k2b-sidebar-item-depth"),
    ).toBe("1");

    notes()
      ?.querySelector<HTMLElement>("[data-k2b-nav-tree-toggle]")
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
    expect(expandedIds()).toEqual(["tags"]);
    expect(notes()?.getAttribute("aria-expanded")).toBe("false");
    expect(recipes()).toBeNull();

    notes()?.focus();
    notes()?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event);
    expect(expandedIds()).toEqual(["tags", "notes"]);
    expect(recipes()).not.toBeNull();

    notes()?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event);
    await Promise.resolve();
    expect(dom.document.activeElement).toBe(recipes());

    recipes()?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }) as unknown as Event);
    expect(dom.document.activeElement?.getAttribute("data-k2b-nav-tree-id")).toBe("recipe-tag");

    (tags()?.firstElementChild as HTMLElement | null)?.click();
    expect(selectedId()).toBe("tags");
    expect(tags()?.getAttribute("aria-selected")).toBe("true");

    const group = dom.root.querySelector<HTMLElement>('[data-k2b-nav-tree-id="group"]');
    expect(group?.getAttribute("aria-expanded")).toBe("true");
    (group?.firstElementChild as HTMLElement | null)?.click();
    expect(group?.getAttribute("aria-expanded")).toBe("false");
    expect(dom.root.querySelector('[data-k2b-nav-tree-id="group-child"]')).toBeNull();

    dispose();
    dom.cleanup();
  });
});
