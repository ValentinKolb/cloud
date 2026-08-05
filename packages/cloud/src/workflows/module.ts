import { workflowBuiltinActionDescriptors } from "./builtins";
import type { WorkflowActionDescriptor, WorkflowLanguageManifest } from "./contracts";
import { LANGUAGE_EFFECT, type WorkflowActionMap, type WorkflowEventMap, type WorkflowModule } from "./definition";

export type DefinedWorkflowModule<
  Actions extends WorkflowActionMap = WorkflowActionMap,
  Events extends WorkflowEventMap = WorkflowEventMap,
> = {
  kind: "workflowModule";
  actions: Actions;
  events: Events;
  manifest: WorkflowLanguageManifest;
};

const isDefinedWorkflowModule = (value: object): value is DefinedWorkflowModule =>
  Object.hasOwn(value, "kind") && (value as { kind?: unknown }).kind === "workflowModule";

export const workflowActionDescriptors = (actions: WorkflowActionMap, namespace?: string): WorkflowActionDescriptor[] =>
  Object.entries(actions).map(([key, action]) => ({
    kind: namespace ? `${namespace}.${key}` : key,
    label: action.label,
    description: action.description,
    config: action.config,
    effect: LANGUAGE_EFFECT[action.effect],
    ...(action.outputType ? { outputType: action.outputType } : {}),
    dryRun: action.effect === "pure" ? "full" : "validate",
  }));

export const defineWorkflowModule = <const Actions extends WorkflowActionMap, const Events extends WorkflowEventMap>(
  definition: Omit<WorkflowLanguageManifest, "actions"> & WorkflowModule & { actions: Actions; events: Events },
): DefinedWorkflowModule<Actions, Events> => {
  const { actions, events, ...language } = definition;
  return {
    kind: "workflowModule",
    actions,
    events,
    manifest: {
      ...language,
      actions: [...workflowActionDescriptors(actions), ...workflowBuiltinActionDescriptors],
    },
  };
};

export const workflowModuleActions = (source: WorkflowActionMap | DefinedWorkflowModule): WorkflowActionMap =>
  isDefinedWorkflowModule(source) ? source.actions : source;
