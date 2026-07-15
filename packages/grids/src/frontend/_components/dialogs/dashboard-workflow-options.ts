import type { Workflow } from "../../../service";

export type DashboardWorkflowOption = Workflow & {
  dashboardLauncher: {
    id: string;
    name: string;
    kind: "dashboard" | "scanner";
    enabled: boolean;
  };
};

export const dashboardWorkflowOption = (workflow: Workflow): DashboardWorkflowOption => workflow as DashboardWorkflowOption;

export const dashboardWorkflowSelectOption = (workflow: Workflow) => {
  const launcher = dashboardWorkflowOption(workflow).dashboardLauncher;
  const kind = launcher.kind === "scanner" ? "Scanner" : "Dashboard button";
  return {
    id: launcher.id,
    label: `${workflow.name} · ${launcher.name}`,
    description: launcher.enabled ? `${kind}${workflow.description ? ` · ${workflow.description}` : ""}` : `${kind} · Disabled`,
    icon: launcher.enabled ? "ti ti-route" : "ti ti-player-pause",
  };
};
