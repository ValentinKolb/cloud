import type { GridsWorkflowLauncher, GridsWorkflowLauncherConfig } from "../../../workflows/contracts";

export const dashboardLauncherConfigForSave = (
  launcher?: GridsWorkflowLauncher,
): Extract<GridsWorkflowLauncherConfig, { kind: "dashboard" }> =>
  launcher?.config.kind === "dashboard" ? { ...launcher.config } : { kind: "dashboard" };
