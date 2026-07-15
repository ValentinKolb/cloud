import { describe, expect, test } from "bun:test";
import type { Workflow } from "../../../service";
import { type DashboardWorkflowOption, dashboardWorkflowSelectOption } from "./dashboard-workflow-options";

const workflowOption = (launcher: DashboardWorkflowOption["dashboardLauncher"]): Workflow =>
  ({
    name: "Approval",
    description: "Review the selected request",
    dashboardLauncher: launcher,
  }) as unknown as Workflow;

describe("dashboard workflow options", () => {
  test("distinguishes multiple launchers for the same workflow", () => {
    const dashboard = dashboardWorkflowSelectOption(
      workflowOption({ id: "dashboard-id", name: "Approve", kind: "dashboard", enabled: true }),
    );
    const scanner = dashboardWorkflowSelectOption(
      workflowOption({ id: "scanner-id", name: "Scan approval", kind: "scanner", enabled: true }),
    );

    expect(dashboard).toMatchObject({
      id: "dashboard-id",
      label: "Approval · Approve",
      description: "Dashboard button · Review the selected request",
    });
    expect(scanner).toMatchObject({
      id: "scanner-id",
      label: "Approval · Scan approval",
      description: "Scanner · Review the selected request",
    });
  });

  test("keeps disabled state visible alongside launcher kind", () => {
    expect(
      dashboardWorkflowSelectOption(workflowOption({ id: "scanner-id", name: "Scan approval", kind: "scanner", enabled: false })),
    ).toMatchObject({ description: "Scanner · Disabled", icon: "ti ti-player-pause" });
  });
});
