import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan, WorkflowInvocation, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type { WorkflowVariableScope } from "@valentinkolb/cloud/workflows/runtime";
import type { GridRecord } from "../contracts";
import { GridsWorkflowValueResolver, prepareWorkflowInputs, WorkflowInputPreparationError } from "./workflow-kernel-values";

const recordId = "11111111-1111-4111-8111-111111111111";
const otherRecordId = "22222222-2222-4222-8222-222222222222";
const tableId = "33333333-3333-4333-8333-333333333333";
const fieldId = "44444444-4444-4444-8444-444444444444";

const plan: WorkflowBoundPlan = {
  schemaVersion: 1,
  languageId: "grids",
  languageVersion: 1,
  sourceHash: "source",
  manifestHash: "manifest",
  catalogHash: "catalog",
  inputs: [
    { name: "item", type: "record", config: { table: "Items", required: true } },
    { name: "items", type: "recordList", config: { table: "Items" } },
    { name: "note", type: "text", config: {} },
  ],
  triggers: [],
  steps: [],
  bindings: {
    "inputs.item.table": tableId,
    "inputs.items.table": tableId,
    "steps.0.setVariable.value": fieldId,
  },
};

describe("workflow kernel inputs", () => {
  test("normalizes record inputs after permission and existence checks", async () => {
    const prepared = await prepareWorkflowInputs(
      plan,
      { item: recordId, items: [recordId, otherRecordId], note: "ready" },
      {
        canReadTable: async (id) => id === tableId,
        existingRecordIds: async () => new Set([recordId, otherRecordId]),
      },
    );

    expect(prepared).toEqual({
      item: { kind: "record", tableId, recordId },
      items: [
        { kind: "record", tableId, recordId },
        { kind: "record", tableId, recordId: otherRecordId },
      ],
      note: "ready",
    });
  });

  test("rejects unknown, missing, inaccessible, and absent record inputs", async () => {
    const deps = { canReadTable: async () => true, existingRecordIds: async () => new Set<string>() };
    await expect(prepareWorkflowInputs(plan, { note: "ready" }, deps)).rejects.toThrow('workflow input "item" is required');
    await expect(prepareWorkflowInputs(plan, { item: recordId, extra: true }, deps)).rejects.toThrow('unknown workflow input "extra"');
    await expect(prepareWorkflowInputs(plan, { item: recordId }, deps)).rejects.toThrow("references missing record");
    await expect(prepareWorkflowInputs(plan, { item: recordId }, { ...deps, canReadTable: async () => false })).rejects.toThrow(
      "cannot read the input table",
    );
  });

  test("distinguishes invalid input, forbidden records, and infrastructure failures", async () => {
    const invalid = prepareWorkflowInputs(
      plan,
      { note: "ready" },
      {
        canReadTable: async () => true,
        existingRecordIds: async () => new Set(),
      },
    );
    await expect(invalid).rejects.toMatchObject({ name: "WorkflowInputPreparationError", status: 400 });

    const forbidden = prepareWorkflowInputs(
      plan,
      { item: recordId },
      {
        canReadTable: async () => false,
        existingRecordIds: async () => new Set(),
      },
    );
    await expect(forbidden).rejects.toMatchObject({ name: "WorkflowInputPreparationError", status: 403 });

    const databaseError = new Error("database unavailable");
    await expect(
      prepareWorkflowInputs(
        plan,
        { item: recordId },
        {
          canReadTable: async () => true,
          existingRecordIds: async () => Promise.reject(databaseError),
        },
      ),
    ).rejects.toBe(databaseError);
    expect(databaseError).not.toBeInstanceOf(WorkflowInputPreparationError);
  });
});

describe("workflow kernel value resolver", () => {
  test("loads a bound record field once and leaves structured values to the kernel", async () => {
    let reads = 0;
    const record = {
      id: recordId,
      tableId,
      data: { [fieldId]: "Returned" },
      version: 1,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    } satisfies GridRecord;
    const resolver = new GridsWorkflowValueResolver({
      canReadTable: async () => true,
      readRecord: async () => {
        reads += 1;
        return record;
      },
    });
    const invocation = {
      workflowId: recordId,
      mode: "execute",
      channel: "api",
      actor: {},
      inputs: { item: { kind: "record", tableId, recordId }, note: { value: "plain" } },
      idempotencyKey: "run-1",
      occurredAt: new Date(0).toISOString(),
    } satisfies WorkflowInvocation;
    const variables: WorkflowVariableScope = {
      get: () => undefined,
      has: () => false,
      set: () => undefined,
    };
    const resolve = (reference: string, path: Array<string | number>, fallback: WorkflowJsonValue | undefined) =>
      resolver.resolve({ reference, path, plan, invocation, variables, fallback: () => fallback });

    expect(await resolve("inputs.item.Name", ["steps", 0, "setVariable", "value"], undefined)).toBe("Returned");
    expect(await resolve("inputs.item.Name", ["steps", 0, "setVariable", "value"], undefined)).toBe("Returned");
    expect(await resolve("inputs.note.value", ["steps", 1], "plain")).toBe("plain");
    expect(reads).toBe(1);
  });
});
