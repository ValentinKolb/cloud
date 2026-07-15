import { describe, expect, test } from "bun:test";
import type { WorkflowIrInput } from "@valentinkolb/cloud/workflows";
import type { GridsWorkflowLauncher } from "../../../workflows/contracts";
import { dashboardLauncherConfigForSave, missingLauncherRequiredInputs } from "./workflow-launcher-draft";

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

  test("replaces dashboard fixed input bindings when edited", () => {
    const launcher = {
      config: { kind: "dashboard", label: "Refresh", inputBindings: { range: "30d" } },
    } as unknown as GridsWorkflowLauncher;

    expect(dashboardLauncherConfigForSave(launcher, { range: "7d", notify: false })).toEqual({
      kind: "dashboard",
      label: "Refresh",
      inputBindings: { range: "7d", notify: false },
    });
  });

  test("reports required inputs not supplied by scanner or bulk launchers", () => {
    const inputs: WorkflowIrInput[] = [
      { name: "record", type: "record", config: { label: "Loan", required: true } },
      { name: "notify", type: "boolean", config: { label: "Notify owner", required: true } },
      { name: "note", type: "text", config: {} },
    ];

    expect(missingLauncherRequiredInputs(inputs, "scanner", "record")).toEqual(["Notify owner"]);
    expect(missingLauncherRequiredInputs(inputs, "dashboard", "")).toEqual([]);
  });
});
