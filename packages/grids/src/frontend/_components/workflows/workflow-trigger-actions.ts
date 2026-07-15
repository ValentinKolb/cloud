import type { WorkflowIrInput, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";

export type WorkflowRunInputDraftValue = string | number | boolean | string[] | null | undefined;
export type WorkflowRunInputDraft = Record<string, WorkflowRunInputDraftValue>;

type WorkflowRunInputResult = { ok: true; input: Record<string, WorkflowJsonValue> } | { ok: false; errors: Record<string, string> };

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

export const workflowInputDraftFromValues = (
  inputs: WorkflowIrInput[],
  values: Record<string, WorkflowJsonValue> | undefined,
): WorkflowRunInputDraft => {
  const draft: WorkflowRunInputDraft = {};
  for (const input of inputs) {
    const value = values?.[input.name];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      (Array.isArray(value) && value.every((item) => typeof item === "string"))
    ) {
      draft[input.name] = value as WorkflowRunInputDraftValue;
    }
  }
  return draft;
};

const missingValue = (value: WorkflowRunInputDraftValue): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

export const buildWorkflowRunInput = (inputs: WorkflowIrInput[], draft: WorkflowRunInputDraft): WorkflowRunInputResult => {
  const result: Record<string, WorkflowJsonValue> = {};
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
