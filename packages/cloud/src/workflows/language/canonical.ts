import { crypto } from "@valentinkolb/stdlib";
import type { WorkflowJsonValue } from "../contracts";

const normalizeUnknown = (value: unknown, path: string): WorkflowJsonValue => {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => normalizeUnknown(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain JSON object`);
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeUnknown(item, `${path}.${key}`)] as const);
    return Object.fromEntries(entries) as Record<string, WorkflowJsonValue>;
  }
  throw new TypeError(`${path} must contain only JSON values`);
};

export const normalizeWorkflowJson = <T extends WorkflowJsonValue>(value: T): T => normalizeUnknown(value, "value") as T;

export const canonicalWorkflowJson = (value: unknown): string => JSON.stringify(normalizeUnknown(value, "value"));

export const hashWorkflowJson = (value: unknown): Promise<string> => crypto.common.hash(canonicalWorkflowJson(value));

export const hashWorkflowSource = (source: string): Promise<string> => crypto.common.hash(source);
