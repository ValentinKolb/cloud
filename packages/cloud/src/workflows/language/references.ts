import type { WorkflowJsonValue } from "../contracts";

export const WORKFLOW_RESERVED_REFERENCE_ROOTS = ["inputs", "trigger", "bindings", "context"] as const;

const reservedReferenceRoots = new Set<string>(WORKFLOW_RESERVED_REFERENCE_ROOTS);
const canonicalArrayIndex = /^(?:0|[1-9][0-9]*)$/;
const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export const isWorkflowReservedReferenceRoot = (value: string): boolean => reservedReferenceRoots.has(value);

export type WorkflowValuePathDescriptor =
  | { kind: "scalar"; type: string }
  | { kind: "object"; type: string; properties: Readonly<Record<string, WorkflowValuePathDescriptor>> }
  | { kind: "array"; type: string; items: WorkflowValuePathDescriptor; elements?: readonly WorkflowValuePathDescriptor[] };

const arrayIndex = (segment: string): number | null => {
  if (!canonicalArrayIndex.test(segment)) return null;
  const index = Number(segment);
  return Number.isSafeInteger(index) ? index : null;
};

export const resolveWorkflowValuePathDescriptor = (
  descriptor: WorkflowValuePathDescriptor,
  path: readonly string[],
): WorkflowValuePathDescriptor | null => {
  let current = descriptor;
  for (const segment of path) {
    if (current.kind === "array") {
      const index = arrayIndex(segment);
      if (index === null) return null;
      const item = current.elements ? current.elements[index] : current.items;
      if (!item) return null;
      current = item;
      continue;
    }
    if (current.kind !== "object" || !hasOwn(current.properties, segment)) return null;
    current = current.properties[segment]!;
  }
  return current;
};

export const readWorkflowValuePath = (value: WorkflowJsonValue, path: readonly string[]): WorkflowJsonValue | undefined => {
  let current: WorkflowJsonValue | undefined = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment);
      if (index === null || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== "object" || !hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
};
