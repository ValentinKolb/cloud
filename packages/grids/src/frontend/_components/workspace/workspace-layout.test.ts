import { describe, expect, test } from "bun:test";
import { workspaceMainClass } from "./workspace-layout";

describe("workspaceMainClass", () => {
  test("insets reading and overview routes", () => {
    expect(workspaceMainClass("empty")).toBe("p-[var(--ui-space-shell)]");
    expect(workspaceMainClass("workflows")).toBe("p-[var(--ui-space-shell)]");
  });

  test("leaves workbench routes edge to edge", () => {
    expect(workspaceMainClass("dashboard")).toBeUndefined();
    expect(workspaceMainClass("documentTemplate")).toBeUndefined();
    expect(workspaceMainClass("query")).toBeUndefined();
    expect(workspaceMainClass("records")).toBeUndefined();
  });
});
