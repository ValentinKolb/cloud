import { describe, expect, test } from "bun:test";
import { collectWorkflowRunInputRecordIds, workflowOverviewRedirectHref } from "./workspace-workflow-state";

describe("workflowOverviewRedirectHref", () => {
  test("targets the first workflow while preserving page state", () => {
    const current = new URL("https://cloud.example/app/grids/BASE1/workflows?edit=true&status=failed");

    expect(workflowOverviewRedirectHref(current, "BASE1", "FLOW1")).toBe("/app/grids/BASE1/workflows/FLOW1?edit=true&status=failed");
  });

  test("removes a stale selected run", () => {
    const current = new URL("https://cloud.example/app/grids/BASE1/workflows?run=11111111-1111-4111-8111-111111111111&edit=true");

    expect(workflowOverviewRedirectHref(current, "BASE1", "FLOW1")).toBe("/app/grids/BASE1/workflows/FLOW1?edit=true");
  });
});

describe("collectWorkflowRunInputRecordIds", () => {
  test("groups valid record inputs by their bound table", () => {
    const tableId = "00000000-0000-4000-8000-000000000001";
    const recordId = "00000000-0000-4000-8000-000000000002";
    const listRecordId = "00000000-0000-4000-8000-000000000003";
    const result = collectWorkflowRunInputRecordIds({ inputs: { item: recordId, items: [listRecordId, "invalid"], text: recordId } }, {
      plan: {
        inputs: [
          { name: "item", type: "record", required: true, config: {} },
          { name: "items", type: "recordList", required: true, config: {} },
          { name: "text", type: "text", required: true, config: {} },
        ],
        bindings: {
          "inputs.item.table": tableId,
          "inputs.items.table": tableId,
        },
      },
    } as never);

    expect([...result.entries()]).toEqual([[tableId, new Set([recordId, listRecordId])]]);
  });
});
