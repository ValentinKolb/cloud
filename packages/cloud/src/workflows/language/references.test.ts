import { describe, expect, test } from "bun:test";
import type { WorkflowJsonValue } from "../contracts";
import {
  isWorkflowReservedReferenceRoot,
  readWorkflowValuePath,
  resolveWorkflowValuePathDescriptor,
  WORKFLOW_RESERVED_REFERENCE_ROOTS,
  type WorkflowValuePathDescriptor,
} from "./references";

const text: WorkflowValuePathDescriptor = { kind: "scalar", type: "core.text" };

describe("workflow references", () => {
  test("reserves every runtime-owned reference root", () => {
    expect(WORKFLOW_RESERVED_REFERENCE_ROOTS).toEqual(["inputs", "trigger", "bindings", "context"]);
    expect(WORKFLOW_RESERVED_REFERENCE_ROOTS.every(isWorkflowReservedReferenceRoot)).toBe(true);
    expect(isWorkflowReservedReferenceRoot("output")).toBe(false);
  });

  test("resolves complete own-property object and canonical array paths", () => {
    const properties = Object.assign(Object.create({ inherited: text }) as Record<string, WorkflowValuePathDescriptor>, {
      rows: { kind: "array", type: "core.array", items: { kind: "object", type: "row", properties: { name: text } } },
    });
    const descriptor: WorkflowValuePathDescriptor = { kind: "object", type: "root", properties };

    expect(resolveWorkflowValuePathDescriptor(descriptor, ["rows", "0", "name"])).toEqual(text);
    expect(resolveWorkflowValuePathDescriptor(descriptor, ["inherited"])).toBeNull();
    expect(resolveWorkflowValuePathDescriptor(descriptor, ["rows", "01"])).toBeNull();
    expect(resolveWorkflowValuePathDescriptor(descriptor, ["rows", "0", "missing"])).toBeNull();
    expect(resolveWorkflowValuePathDescriptor(descriptor, ["rows", "0", "name", "nested"])).toBeNull();
  });

  test("reads values with the same own-property and array-index rules", () => {
    const row = Object.assign(Object.create({ inherited: "hidden" }) as Record<string, WorkflowJsonValue>, { name: "Ada" });
    const value = { rows: [row] } as WorkflowJsonValue;

    expect(readWorkflowValuePath(value, ["rows", "0", "name"])).toBe("Ada");
    expect(readWorkflowValuePath(value, ["rows", "0", "inherited"])).toBeUndefined();
    expect(readWorkflowValuePath(value, ["rows", "01", "name"])).toBeUndefined();
    expect(readWorkflowValuePath(value, ["rows", "1"])).toBeUndefined();
  });
});
