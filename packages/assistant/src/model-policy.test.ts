import { describe, expect, test } from "bun:test";
import { assistantModelPolicy } from "./model-policy";

describe("Assistant model policy", () => {
  test("requires tool-capable streaming models", () => {
    expect(assistantModelPolicy).toEqual({ kind: "selectable", requiredCapabilities: ["streaming", "tools"] });
  });
});
