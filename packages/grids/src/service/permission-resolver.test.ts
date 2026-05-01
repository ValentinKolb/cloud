import { test, expect, describe } from "bun:test";
import { resolveEffectivePermission, hasAtLeast, type Grant } from "./permission-resolver";

const baseId = "base-1";
const tableId = "table-1";
const viewId = "view-1";

describe("resolveEffectivePermission", () => {
  test("no grants → none", () => {
    expect(resolveEffectivePermission([], { baseId, tableId })).toBe("none");
  });

  test("base-write only → write at base", () => {
    const grants: Grant[] = [{ resourceType: "base", resourceId: baseId, level: "write" }];
    expect(resolveEffectivePermission(grants, { baseId })).toBe("write");
  });

  test("base-write inherits to table when no table grant", () => {
    const grants: Grant[] = [{ resourceType: "base", resourceId: baseId, level: "write" }];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("write");
  });

  test("table-read overrides base-write (most-specific wins)", () => {
    const grants: Grant[] = [
      { resourceType: "base", resourceId: baseId, level: "write" },
      { resourceType: "table", resourceId: tableId, level: "read" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("read");
  });

  test("explicit deny: table-none shadows base-write", () => {
    const grants: Grant[] = [
      { resourceType: "base", resourceId: baseId, level: "write" },
      { resourceType: "table", resourceId: tableId, level: "none" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("none");
  });

  test("multiple grants at same level → highest wins", () => {
    const grants: Grant[] = [
      { resourceType: "table", resourceId: tableId, level: "read" },
      { resourceType: "table", resourceId: tableId, level: "admin" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("admin");
  });

  test("view-grant shadows table-grant for view-target", () => {
    const grants: Grant[] = [
      { resourceType: "table", resourceId: tableId, level: "write" },
      { resourceType: "view", resourceId: viewId, level: "none" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId, viewId })).toBe("none");
  });

  test("view with no grant inherits from table", () => {
    const grants: Grant[] = [{ resourceType: "table", resourceId: tableId, level: "write" }];
    expect(resolveEffectivePermission(grants, { baseId, tableId, viewId })).toBe("write");
  });

  test("grants for different bases ignored", () => {
    const grants: Grant[] = [{ resourceType: "base", resourceId: "other-base", level: "admin" }];
    expect(resolveEffectivePermission(grants, { baseId })).toBe("none");
  });

  test("grants for different views ignored at view-level", () => {
    const grants: Grant[] = [
      { resourceType: "table", resourceId: tableId, level: "read" },
      { resourceType: "view", resourceId: "other-view", level: "none" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId, viewId })).toBe("read");
  });
});

describe("hasAtLeast", () => {
  test("compares correctly across all levels", () => {
    expect(hasAtLeast("admin", "write")).toBe(true);
    expect(hasAtLeast("write", "admin")).toBe(false);
    expect(hasAtLeast("read", "read")).toBe(true);
    expect(hasAtLeast("none", "read")).toBe(false);
  });
});
