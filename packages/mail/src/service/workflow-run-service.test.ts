import { describe, expect, test } from "bun:test";
import { retryWorkflowRunChannel } from "./workflow-run-service";

describe("Mail workflow retry channel", () => {
  test("preserves automatic trigger channels for retried provider effects", () => {
    expect(retryWorkflowRunChannel({ kind: "trigger", channel: "event" }, "api")).toBe("event");
    expect(retryWorkflowRunChannel({ kind: "trigger", channel: "schedule" }, "ui")).toBe("schedule");
  });

  test("uses the current actor channel for manually started runs", () => {
    expect(retryWorkflowRunChannel({ kind: "invoke", channel: "ui" }, "agent")).toBe("agent");
  });
});
