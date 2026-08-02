import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("Notebooks navigator hydration contract", () => {
  test("controls tree expansion across SSR and hydration", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "[id]/_components/sidebar/NotebookNavigator.tsx")).text();

    expect(source).toContain("expandedIds={expandedTreeIds()}");
    expect(source).toContain("onExpandedIdsChange={setExpandedTreeIds}");
    expect(source).not.toContain("defaultExpandedIds=");
  });

  test("inherits the cookie-backed workspace layout rendered by Cloud", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "[id]/page.tsx")).text();

    expect(source).toContain('<AppWorkspace class="flex-1 min-h-0">');
    expect(source).not.toContain("initialWorkspaceLayout");
    expect(source).not.toContain("layoutState={() =>");
  });

  test("gives presence identities a visible gap", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "[id]/_components/detail/NotebookDetailPanel.island.tsx")).text();

    expect(source).toContain('<li class="detail-row items-center gap-3">');
  });

  test("renders primary notebook destinations as an icon-only grid", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "[id]/_components/sidebar/NotebookNavigator.tsx")).text();

    expect(source).toContain("<AppWorkspace.SidebarIconGrid columns={2}>");
    expect(source).toContain('label="Homepage"');
    expect(source).toContain('variant="workspace-icon"');
    expect(source).not.toContain('meta={root.id === "favorites"');
  });
});
