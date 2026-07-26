import { describe, expect, test } from "bun:test";
import { mailWorkflowDependencyDeadline } from "./workflow-dependencies";

describe("Mail workflow dependencies", () => {
  test("carry a bounded durable recheck deadline", () => {
    const now = new Date("2026-07-26T12:00:00.000Z");

    expect(mailWorkflowDependencyDeadline(now)).toBe("2026-07-26T12:00:30.000Z");
  });
});
