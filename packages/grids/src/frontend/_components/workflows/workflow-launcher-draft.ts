import type { WorkflowIrInput, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type { GridsWorkflowLauncher, GridsWorkflowLauncherConfig, GridsWorkflowLauncherKind } from "../../../workflows/contracts";
import { workflowInputLabel, workflowInputRequired } from "./workflow-trigger-actions";

export const dashboardLauncherConfigForSave = (
  launcher?: GridsWorkflowLauncher,
  inputBindings?: Record<string, WorkflowJsonValue>,
): Extract<GridsWorkflowLauncherConfig, { kind: "dashboard" }> =>
  launcher?.config.kind === "dashboard"
    ? { ...launcher.config, ...(inputBindings === undefined ? {} : { inputBindings }) }
    : { kind: "dashboard", ...(inputBindings === undefined ? {} : { inputBindings }) };

export const missingLauncherRequiredInputs = (
  inputs: WorkflowIrInput[],
  kind: GridsWorkflowLauncherKind,
  controlledInput: string,
): string[] =>
  kind === "dashboard"
    ? []
    : inputs.filter((input) => workflowInputRequired(input) && input.name !== controlledInput).map((input) => workflowInputLabel(input));
