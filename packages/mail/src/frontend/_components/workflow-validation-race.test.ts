import { describe, expect, test } from "bun:test";
import { shouldApplyWorkflowValidation } from "./workflow-validation-race";

describe("Mail workflow validation race", () => {
  test("accepts only the latest response for the current exact source", () => {
    expect(
      shouldApplyWorkflowValidation({
        requestId: 3,
        latestRequestId: 3,
        requestedSource: "steps: []\n",
        currentSource: "steps: []\n",
        aborted: false,
      }),
    ).toBe(true);
    expect(
      shouldApplyWorkflowValidation({
        requestId: 2,
        latestRequestId: 3,
        requestedSource: "steps: []\n",
        currentSource: "steps: []\n",
        aborted: false,
      }),
    ).toBe(false);
    expect(
      shouldApplyWorkflowValidation({
        requestId: 3,
        latestRequestId: 3,
        requestedSource: "steps: []\n",
        currentSource: "steps:\n  - succeed: {}\n",
        aborted: false,
      }),
    ).toBe(false);
  });
});
