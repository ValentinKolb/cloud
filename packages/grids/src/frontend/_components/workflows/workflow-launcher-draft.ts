import type { WorkflowIrInput, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type { GridsWorkflowLauncher, GridsWorkflowLauncherConfig, GridsWorkflowLauncherKind } from "../../../workflows/contracts";
import { workflowInputLabel, workflowInputRequired } from "./workflow-trigger-actions";

export const dashboardLauncherConfigForSave = (
  launcher?: GridsWorkflowLauncher,
  inputMode: "fixed" | "prompt" = "fixed",
  inputBindings?: Record<string, WorkflowJsonValue>,
): Extract<GridsWorkflowLauncherConfig, { kind: "dashboard" }> =>
  inputMode === "prompt"
    ? {
        kind: "dashboard",
        ...(launcher?.config.kind === "dashboard" && launcher.config.label ? { label: launcher.config.label } : {}),
        inputMode,
      }
    : {
        kind: "dashboard",
        ...(launcher?.config.kind === "dashboard" && launcher.config.label ? { label: launcher.config.label } : {}),
        inputMode,
        ...(inputBindings === undefined
          ? launcher?.config.kind === "dashboard" && launcher.config.inputBindings
            ? { inputBindings: launcher.config.inputBindings }
            : {}
          : { inputBindings }),
      };

export const missingLauncherRequiredInputs = (
  inputs: WorkflowIrInput[],
  kind: GridsWorkflowLauncherKind,
  controlledInput: string,
): string[] =>
  kind === "dashboard"
    ? []
    : inputs.filter((input) => workflowInputRequired(input) && input.name !== controlledInput).map((input) => workflowInputLabel(input));
