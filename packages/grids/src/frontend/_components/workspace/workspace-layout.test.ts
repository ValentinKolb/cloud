import { describe, expect, test } from "bun:test";
import { workspaceMainClass } from "./workspace-layout";

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
