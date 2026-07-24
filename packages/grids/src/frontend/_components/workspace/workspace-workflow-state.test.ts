import { describe, expect, test } from "bun:test";
import { workflowOverviewRedirectHref } from "./workspace-workflow-state";

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
