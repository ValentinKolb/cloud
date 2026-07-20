import { describe, expect, test } from "bun:test";
import { workspaceMainClass, workspaceRootClass } from "./workspace-layout";

describe("workspaceMainClass", () => {
  test("insets standard content routes", () => {
    expect(workspaceMainClass("dashboard")).toBe("p-[var(--ui-space-shell)]");
    expect(workspaceMainClass("empty")).toBe("p-[var(--ui-space-shell)]");
    expect(workspaceMainClass("records")).toBe("p-[var(--ui-space-shell)]");
    expect(workspaceMainClass("workflows")).toBe("p-[var(--ui-space-shell)]");
  });

  test("leaves pane and file-manager routes edge to edge", () => {
    expect(workspaceMainClass("documentTemplate")).toBeUndefined();
    expect(workspaceMainClass("query")).toBeUndefined();
  });
});

describe("workspaceRootClass", () => {
  test("adds one edit-mode marker without changing workspace geometry", () => {
    expect(workspaceRootClass(false)).toBe("min-h-0 flex-1");
    expect(workspaceRootClass(true)).toBe("min-h-0 flex-1 grids-workspace-editing");
  });
});
