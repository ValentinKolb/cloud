import type { WorkflowIrInput, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";

export type WorkflowRunInputDraftValue = string | number | boolean | string[] | null | undefined;
export type WorkflowRunInputDraft = Record<string, WorkflowRunInputDraftValue>;

type WorkflowRunInputResult = { ok: true; input: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

const configString = (input: WorkflowIrInput, key: string): string | undefined => {
  const value = input.config[key];
  return typeof value === "string" ? value : undefined;
};

const configBoolean = (input: WorkflowIrInput, key: string): boolean => input.config[key] === true;

export const workflowInputLabel = (input: WorkflowIrInput): string => configString(input, "label") ?? input.name;
export const workflowInputDescription = (input: WorkflowIrInput): string | undefined => configString(input, "description");
export const workflowInputRequired = (input: WorkflowIrInput): boolean => configBoolean(input, "required");
export const workflowInputOptions = (input: WorkflowIrInput): string[] => {
  const options = input.config.options;
  return Array.isArray(options) ? options.filter((option): option is string => typeof option === "string") : [];
};

const missingValue = (value: WorkflowRunInputDraftValue): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

export const buildWorkflowRunInput = (inputs: WorkflowIrInput[], draft: WorkflowRunInputDraft): WorkflowRunInputResult => {
  const result: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const definition of inputs) {
    const name = definition.name;
    const value = draft[name];
    if (missingValue(value)) {
      if (workflowInputRequired(definition)) errors[name] = `${workflowInputLabel(definition)} is required.`;
      continue;
    }

    if (definition.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      errors[name] = `${workflowInputLabel(definition)} must be a number.`;
      continue;
    }
    if (definition.type === "boolean" && typeof value !== "boolean") {
      errors[name] = `${workflowInputLabel(definition)} must be true or false.`;
      continue;
    }
    if (definition.type === "recordList" && !Array.isArray(value)) {
      errors[name] = `${workflowInputLabel(definition)} must contain records.`;
      continue;
    }
    if (definition.type !== "number" && definition.type !== "boolean" && definition.type !== "recordList" && typeof value !== "string") {
      errors[name] = `${workflowInputLabel(definition)} is invalid.`;
      continue;
    }

    result[name] = value as WorkflowJsonValue;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, input: result };
};
