import { describe, expect, test } from "bun:test";
import { validateAccessLevelForResource } from "./access";

describe("validateAccessLevelForResource", () => {
  test("document templates allow read, write, admin, and none", () => {
    for (const level of ["read", "write", "admin", "none"]) {
      expect(validateAccessLevelForResource("documentTemplate", level), level).toBeNull();
    }
  });

  test("document templates reject unsupported access levels", () => {
    expect(validateAccessLevelForResource("documentTemplate", "owner")).toBe(
      "Document template grants only accept 'read', 'write', 'admin', or 'none'",
    );
  });

  test("other resource-specific access rules stay narrow", () => {
    expect(validateAccessLevelForResource("table", "admin")).toBe("Table grants only accept 'read' / 'write' / 'none'");
    expect(validateAccessLevelForResource("form", "read")).toBe("Form grants only accept 'write' or 'none'");
    expect(validateAccessLevelForResource("dashboard", "write")).toBe("Dashboard grants only accept 'read' or 'none'");
  });
});
