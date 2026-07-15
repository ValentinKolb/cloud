import type {
  WorkflowActionDescriptor,
  WorkflowExecutionError,
  WorkflowFieldSchema,
  WorkflowJsonValue,
  WorkflowPlanningOutcome,
  WorkflowStepOutcome,
} from "./contracts";
import { workflowMessageExpressions } from "./language/expressions";
import type {
  WorkflowActionStep,
  WorkflowDryRunActionContext,
  WorkflowDryRunActionPort,
  WorkflowExecuteActionContext,
  WorkflowExecuteActionPort,
} from "./runtime/ports";

const identifier = (description: string): WorkflowFieldSchema => ({
  kind: "string",
  format: "identifier",
  maxLength: 120,
  description,
});

const text = (description: string): WorkflowFieldSchema => ({
  kind: "string",
  minLength: 1,
  maxLength: 1_000,
  description,
});

const object = (properties: Record<string, WorkflowFieldSchema>): WorkflowFieldSchema & { kind: "object" } => ({
  kind: "object",
  properties,
});

export const workflowBuiltinActionDescriptors = [
  {
    kind: "setVariable",
    label: "Set variable",
    description: "Stores a value for later steps in the current scope.",
    effect: "pure",
    dryRun: "full",
    outputType: "core.value",
    config: object({ name: identifier("Variable name."), value: { kind: "value", description: "Value to store." } }),
  },
  {
    kind: "succeed",
    label: "Succeed workflow",
    description: "Stops the workflow successfully with an operator-facing message.",
    effect: "pure",
    dryRun: "full",
    config: object({ message: text("Operator-facing success message.") }),
  },
  {
    kind: "fail",
    label: "Fail workflow",
    description: "Stops the workflow with an operator-facing error message.",
    effect: "pure",
    dryRun: "full",
    config: object({ message: text("Operator-facing failure message.") }),
  },
] satisfies WorkflowActionDescriptor[];

type WorkflowBuiltinActionContext = WorkflowExecuteActionContext | WorkflowDryRunActionContext;

export type WorkflowBuiltinActionAuthorize = (
  context: WorkflowBuiltinActionContext,
  step: WorkflowActionStep,
) => Promise<WorkflowExecutionError | undefined>;

export type WorkflowBuiltinActionPorts = {
  execute: WorkflowExecuteActionPort;
  dryRun: WorkflowDryRunActionPort;
};

const actionPath = (step: WorkflowActionStep): Array<string | number> => [...step.sourcePath, step.action];

const requiredString = (value: WorkflowJsonValue | undefined, label: string): string => {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be non-empty text`);
  return value;
};

const requiredValue = (value: WorkflowJsonValue | undefined, label: string): WorkflowJsonValue => {
  if (value === undefined) throw new TypeError(`${label} is required`);
  return value;
};

const renderMessage = async (context: WorkflowBuiltinActionContext, step: WorkflowActionStep): Promise<string> => {
  const message = requiredString(step.config.message, `${step.action}.message`);
  let rendered = "";
  let offset = 0;
  for (const [index, expression] of workflowMessageExpressions(message).entries()) {
    rendered += message.slice(offset, expression.index);
    if (!expression.expression) throw new TypeError(`${step.action}.message contains an invalid expression`);
    const path = [...actionPath(step), "message", "expression", index];
    const value =
      expression.expression.kind === "now"
        ? await context.evaluate("${{ now() }}", path)
        : await context.resolveReference(expression.expression.reference, path);
    rendered += value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    offset = expression.index + expression.raw.length;
  }
  return `${rendered}${message.slice(offset)}`;
};

export const createWorkflowBuiltinActionPorts = (options: { authorize: WorkflowBuiltinActionAuthorize }): WorkflowBuiltinActionPorts => {
  const authorize = async (context: WorkflowBuiltinActionContext, step: WorkflowActionStep): Promise<WorkflowExecutionError | undefined> =>
    options.authorize(context, step);

  const execute = async (context: WorkflowExecuteActionContext, step: WorkflowActionStep): Promise<WorkflowStepOutcome> => {
    const authorizationError = await authorize(context, step);
    if (authorizationError) return { state: "failed", error: authorizationError };
    if (step.action === "setVariable") {
      const name = requiredString(step.config.name, "setVariable.name");
      const output = await context.evaluate(requiredValue(step.config.value, "setVariable.value"), [...actionPath(step), "value"]);
      context.variables.set(name, output);
      return { state: "completed", output };
    }
    const message = await renderMessage(context, step);
    return step.action === "succeed"
      ? { state: "terminal", status: "succeeded", message }
      : { state: "failed", error: { code: "WORKFLOW_FAILED", message, retryable: false } };
  };

  const plan = async (context: WorkflowDryRunActionContext, step: WorkflowActionStep): Promise<WorkflowPlanningOutcome> => {
    const authorizationError = await authorize(context, step);
    if (authorizationError) return { state: "indeterminate", reason: authorizationError.message };
    if (step.action === "setVariable") {
      const name = requiredString(step.config.name, "setVariable.name");
      const output = await context.evaluate(requiredValue(step.config.value, "setVariable.value"), [...actionPath(step), "value"]);
      context.variables.set(name, output);
      return { state: "planned", output, effects: [] };
    }
    return {
      state: "terminal",
      status: step.action === "succeed" ? "succeeded" : "failed",
      message: await renderMessage(context, step),
      effects: [],
    };
  };

  const restoreCompleted = (
    context: WorkflowBuiltinActionContext,
    step: WorkflowActionStep,
    outcome: { output?: WorkflowJsonValue },
  ): void => {
    if (step.action === "setVariable" && typeof step.config.name === "string" && outcome.output !== undefined) {
      context.variables.set(step.config.name, outcome.output);
    }
  };

  const actions = new Set(workflowBuiltinActionDescriptors.map(({ kind }) => kind));
  return {
    execute: { get: (action) => (actions.has(action) ? { execute, restoreCompleted } : undefined) },
    dryRun: { get: (action) => (actions.has(action) ? { plan, restoreCompleted } : undefined) },
  };
};
