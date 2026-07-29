import { describe, expect, test } from "bun:test";
import { mailWorkflowActionFailure } from "./workflow-action-errors";

describe("Mail workflow action failures", () => {
  test("retries transient database and lease failures", () => {
    expect(mailWorkflowActionFailure(Object.assign(new Error("serialization"), { code: "40001" })).retryable).toBe(true);
    expect(
      mailWorkflowActionFailure(Object.assign(new Error("connection"), { code: "ERR_POSTGRES_SERVER_ERROR", errno: "08006" })).retryable,
    ).toBe(true);
    expect(mailWorkflowActionFailure(Object.assign(new Error("lease"), { code: "WORKFLOW_LEASE_LOST" })).retryable).toBe(true);
  });

  test("keeps validation and authorization failures terminal", () => {
    expect(mailWorkflowActionFailure(Object.assign(new Error("forbidden"), { code: "FORBIDDEN" }))).toMatchObject({
      code: "FORBIDDEN",
      retryable: false,
    });
  });

  test("preserves messages from structured service failures", () => {
    expect(
      mailWorkflowActionFailure({
        code: "CONFLICT",
        message: "The message changed before the action could be applied",
        status: 409,
      }),
    ).toMatchObject({
      code: "CONFLICT",
      message: "The message changed before the action could be applied",
      retryable: false,
    });
    expect(mailWorkflowActionFailure({ code: "CONFLICT" }).message).toBe("Mail workflow action failed (CONFLICT)");
  });
});
