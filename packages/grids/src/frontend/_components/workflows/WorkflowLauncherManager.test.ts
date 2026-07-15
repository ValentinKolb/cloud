import { describe, expect, test } from "bun:test";
import type { GridsWorkflowLauncher } from "../../../workflows/contracts";
import { dashboardLauncherConfigForSave } from "./workflow-launcher-draft";

describe("workflow launcher editor", () => {
  test("preserves dashboard labels and fixed input bindings while editing metadata", () => {
    const launcher = {
      config: { kind: "dashboard", label: "Refresh", inputBindings: { range: "30d" } },
    } as unknown as GridsWorkflowLauncher;

    expect(dashboardLauncherConfigForSave(launcher)).toEqual({
      kind: "dashboard",
      label: "Refresh",
      inputBindings: { range: "30d" },
    });
  });
});
