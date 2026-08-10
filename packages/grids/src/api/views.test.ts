import { describe, expect, test } from "bun:test";
import { canAdministerView, changesViewSharing } from "./views";

describe("view mutation policy", () => {
  test("requires owning-base admin regardless of legacy view ownership", () => {
    expect(canAdministerView({ level: "read" })).toBe(false);
    expect(canAdministerView({ level: "write" })).toBe(false);
    expect(canAdministerView({ level: "admin" })).toBe(true);
  });

  test("requires a separate gate only when shared visibility actually changes", () => {
    expect(changesViewSharing(true, "owner-id")).toBe(true);
    expect(changesViewSharing(false, null)).toBe(true);
    expect(changesViewSharing(false, "owner-id")).toBe(false);
    expect(changesViewSharing(undefined, null)).toBe(false);
  });
});
