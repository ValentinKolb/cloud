import type { WorkflowDefinition, WorkflowInput, WorkflowTriggerKind } from "../../../contracts";

const triggerKinds: WorkflowTriggerKind[] = ["form", "api", "scanner", "bulkSelection", "dashboardButton", "schedule", "recordEvent"];

const isActiveTrigger = (trigger: unknown): boolean => {
  if (!trigger) return false;
  return !(typeof trigger === "object" && (trigger as { enabled?: unknown }).enabled === false);
};

export const activeWorkflowTriggers = (definition: WorkflowDefinition): WorkflowTriggerKind[] =>
  triggerKinds.filter((kind) => isActiveTrigger(definition.triggers[kind]));

export const directWorkflowRunTriggers = (definition: WorkflowDefinition): WorkflowTriggerKind[] => {
  const active = new Set(activeWorkflowTriggers(definition));
  return (["form", "api", "dashboardButton", "schedule"] as WorkflowTriggerKind[]).filter((kind) => active.has(kind));
};

export type WorkflowRunInputDraftValue = string | number | boolean | string[] | null | undefined;
export type WorkflowRunInputDraft = Record<string, WorkflowRunInputDraftValue>;

type WorkflowRunInputResult = { ok: true; input: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

const inputLabel = (name: string, input: WorkflowInput): string => input.label ?? name;

const missingValue = (value: WorkflowRunInputDraftValue): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

export const buildWorkflowRunInput = (inputs: Record<string, WorkflowInput>, draft: WorkflowRunInputDraft): WorkflowRunInputResult => {
  const result: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const [name, definition] of Object.entries(inputs)) {
    const value = draft[name];
    if (missingValue(value)) {
      if (definition.required) errors[name] = `${inputLabel(name, definition)} is required.`;
      continue;
    }

    if (definition.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      errors[name] = `${inputLabel(name, definition)} must be a number.`;
      continue;
    }
    if (definition.type === "boolean" && typeof value !== "boolean") {
      errors[name] = `${inputLabel(name, definition)} must be true or false.`;
      continue;
    }
    if (definition.type === "recordList" && !Array.isArray(value)) {
      errors[name] = `${inputLabel(name, definition)} must contain records.`;
      continue;
    }
    if (definition.type !== "number" && definition.type !== "boolean" && definition.type !== "recordList" && typeof value !== "string") {
      errors[name] = `${inputLabel(name, definition)} is invalid.`;
      continue;
    }

    result[name] = value;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, input: result };
};
