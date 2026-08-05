import { workflowBuiltinActionDescriptors } from "./builtins";
import type { WorkflowActionDescriptor, WorkflowLanguageManifest } from "./contracts";
import { LANGUAGE_EFFECT, type WorkflowActionMap } from "./definition";

export type DefinedWorkflowModule<Actions extends WorkflowActionMap = WorkflowActionMap> = {
  actions: Actions;
  manifest: WorkflowLanguageManifest;
};

const workflowActionDescriptors = (actions: WorkflowActionMap): WorkflowActionDescriptor[] =>
  Object.entries(actions).map(([key, action]) => ({
    kind: key,
    label: action.label,
    description: action.description,
    config: action.config,
    effect: LANGUAGE_EFFECT[action.effect],
    ...(action.outputType ? { outputType: action.outputType } : {}),
    dryRun: action.effect === "pure" ? "full" : "validate",
  }));

export const defineWorkflowModule = <const Actions extends WorkflowActionMap>(
  definition: Omit<WorkflowLanguageManifest, "actions"> & { actions: Actions },
): DefinedWorkflowModule<Actions> => {
  const { actions, ...language } = definition;
  return {
    actions,
    manifest: {
      ...language,
      actions: [...workflowActionDescriptors(actions), ...workflowBuiltinActionDescriptors],
    },
  };
};
