import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW_URL_STATE, parseWorkflowUrlState, workflowUrlStateHref } from "./workflow-url-state";

describe("workflow URL state", () => {
  test("parses supported filters", () => {
    expect(parseWorkflowUrlState(new URLSearchParams("window=7d&status=failed&channel=api"))).toEqual({
      window: "7d",
      status: "failed",
      channel: "api",
    });
  });

  test("uses safe defaults for missing and invalid filters", () => {
    expect(parseWorkflowUrlState(new URLSearchParams("window=forever&status=broken&channel=unknown"))).toEqual(DEFAULT_WORKFLOW_URL_STATE);
  });

  test("writes non-default filters while preserving unrelated page state", () => {
    const current = new URL("https://cloud.example/app/grids/BASE1/workflows/FLOW1?edit=true&run=11111111-1111-4111-8111-111111111111");

    expect(workflowUrlStateHref(current, { window: "30d", status: "failed", channel: "scanner" })).toBe(
      "/app/grids/BASE1/workflows/FLOW1?edit=true&run=11111111-1111-4111-8111-111111111111&window=30d&status=failed&channel=scanner",
    );
  });

  test("removes default filters from the URL", () => {
    const current = new URL("https://cloud.example/app/grids/BASE1/workflows/FLOW1?window=7d&status=failed&channel=api&edit=true");

    expect(workflowUrlStateHref(current, DEFAULT_WORKFLOW_URL_STATE)).toBe("/app/grids/BASE1/workflows/FLOW1?edit=true");
  });
});
