import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { parseWorkflowValueString } from "@valentinkolb/cloud/workflows/language";
import { err } from "@valentinkolb/stdlib";

const readTriggerPath = (values: Record<string, WorkflowJsonValue>, reference: string): WorkflowJsonValue | undefined => {
  const segments = reference.split(".");
  if (segments.shift() !== "trigger") return undefined;
  let current: WorkflowJsonValue = values;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index]!;
      continue;
    }
    if (current === null || typeof current !== "object" || !(segment in current)) return undefined;
    current = current[segment]!;
  }
  return current;
};

const evaluateTriggerValue = (
  value: WorkflowJsonValue,
  values: Record<string, WorkflowJsonValue>,
  occurredAt: string,
): WorkflowJsonValue => {
  if (typeof value === "string") {
    const parsed = parseWorkflowValueString(value);
    if (parsed.kind === "literal") return value;
    if (parsed.kind === "invalid") throw err.badInput(`invalid workflow trigger expression "${value}"`);
    if (parsed.expression.kind === "now") return occurredAt;
    const resolved = readTriggerPath(values, parsed.expression.reference);
    if (resolved === undefined) throw err.badInput(`workflow trigger value "${parsed.expression.reference}" is unavailable`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map((item) => evaluateTriggerValue(item, values, occurredAt));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, evaluateTriggerValue(item, values, occurredAt)]));
  }
  return value;
};

export const evaluateWorkflowTriggerInputs = (
  values: Record<string, WorkflowJsonValue>,
  bindings: Record<string, WorkflowJsonValue>,
  occurredAt: string,
): Record<string, WorkflowJsonValue> =>
  Object.fromEntries(Object.entries(bindings).map(([name, value]) => [name, evaluateTriggerValue(value, values, occurredAt)]));
