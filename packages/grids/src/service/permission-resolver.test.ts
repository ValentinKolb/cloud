import { describe, expect, test } from "bun:test";
import { type Grant, hasAtLeast, resolveEffectivePermission } from "./permission-resolver";

const baseId = "base-1";
const tableId = "table-1";
const viewId = "view-1";
const documentTemplateId = "template-1";
const dashboardId = "dash-1";
const workflowId = "workflow-1";

// Most tests use the "user" tier (most-specific principal). Cross-tier
// behaviour gets its own block at the bottom.
const u = (g: Omit<Grant, "principalTier">): Grant => ({ ...g, principalTier: "user" });

describe("resolveEffectivePermission — resource scope", () => {
  test("no grants → none", () => {
    expect(resolveEffectivePermission([], { baseId, tableId })).toBe("none");
  });

  test("base-write only → write at base", () => {
    const grants: Grant[] = [u({ resourceType: "base", resourceId: baseId, level: "write" })];
    expect(resolveEffectivePermission(grants, { baseId })).toBe("write");
  });

  test("base-write inherits to table when no table grant", () => {
    const grants: Grant[] = [u({ resourceType: "base", resourceId: baseId, level: "write" })];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("write");
  });

  test("table-read overrides base-write (most-specific wins)", () => {
    const grants: Grant[] = [
      u({ resourceType: "base", resourceId: baseId, level: "write" }),
      u({ resourceType: "table", resourceId: tableId, level: "read" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("read");
  });

  test("explicit deny at most-specific scope: table-none shadows base-write", () => {
    const grants: Grant[] = [
      u({ resourceType: "base", resourceId: baseId, level: "write" }),
      u({ resourceType: "table", resourceId: tableId, level: "none" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("none");
  });

  test("multiple grants at same scope+tier → highest non-deny wins", () => {
    const grants: Grant[] = [
      u({ resourceType: "table", resourceId: tableId, level: "read" }),
      u({ resourceType: "table", resourceId: tableId, level: "admin" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("admin");
  });

  test("view-grant shadows table-grant for view-target", () => {
    const grants: Grant[] = [
      u({ resourceType: "table", resourceId: tableId, level: "write" }),
      u({ resourceType: "view", resourceId: viewId, level: "none" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId, viewId })).toBe("none");
  });

  test("view with no grant inherits from table", () => {
    const grants: Grant[] = [u({ resourceType: "table", resourceId: tableId, level: "write" })];
    expect(resolveEffectivePermission(grants, { baseId, tableId, viewId })).toBe("write");
  });

  test("document-template grant shadows table grant for document target", () => {
    const grants: Grant[] = [
      u({ resourceType: "table", resourceId: tableId, level: "write" }),
      u({ resourceType: "documentTemplate", resourceId: documentTemplateId, level: "read" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId, documentTemplateId })).toBe("read");
  });

  test("document template inherits from table when no template grant exists", () => {
    const grants: Grant[] = [u({ resourceType: "table", resourceId: tableId, level: "read" })];
    expect(resolveEffectivePermission(grants, { baseId, tableId, documentTemplateId })).toBe("read");
  });

  test("grants for different bases ignored", () => {
    const grants: Grant[] = [u({ resourceType: "base", resourceId: "other-base", level: "admin" })];
    expect(resolveEffectivePermission(grants, { baseId })).toBe("none");
  });

  test("grants for different views ignored at view-level", () => {
    const grants: Grant[] = [
      u({ resourceType: "table", resourceId: tableId, level: "read" }),
      u({ resourceType: "view", resourceId: "other-view", level: "none" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId, viewId })).toBe("read");
  });
});

describe("resolveEffectivePermission — dashboard target", () => {
  test("dashboard-read at dashboard scope", () => {
    const grants: Grant[] = [u({ resourceType: "dashboard", resourceId: dashboardId, level: "read" })];
    expect(resolveEffectivePermission(grants, { baseId, dashboardId })).toBe("read");
  });

  test("dashboard ACL is independent of table/view ACLs", () => {
    // table-write does NOT cascade to dashboard; dashboard ACL is its own thing.
    const grants: Grant[] = [u({ resourceType: "table", resourceId: tableId, level: "write" })];
    expect(resolveEffectivePermission(grants, { baseId, dashboardId })).toBe("none");
  });

  test("dashboard inherits from base when no dashboard grant", () => {
    const grants: Grant[] = [u({ resourceType: "base", resourceId: baseId, level: "admin" })];
    expect(resolveEffectivePermission(grants, { baseId, dashboardId })).toBe("admin");
  });
});

describe("resolveEffectivePermission — workflow target", () => {
  test("workflow grant shadows base grant for workflow target", () => {
    const grants: Grant[] = [
      u({ resourceType: "base", resourceId: baseId, level: "admin" }),
      u({ resourceType: "workflow", resourceId: workflowId, level: "write" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId, workflowId })).toBe("write");
  });

  test("workflow inherits from base when no workflow grant exists", () => {
    const grants: Grant[] = [u({ resourceType: "base", resourceId: baseId, level: "read" })];
    expect(resolveEffectivePermission(grants, { baseId, workflowId })).toBe("read");
  });
});

describe("resolveEffectivePermission — principal tier", () => {
  test("user tier wins over group tier at same resource", () => {
    const grants: Grant[] = [
      { resourceType: "table", resourceId: tableId, level: "none", principalTier: "user" },
      { resourceType: "table", resourceId: tableId, level: "admin", principalTier: "group" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("none");
  });

  test("service account tier wins over user tier at same resource", () => {
    const grants: Grant[] = [
      { resourceType: "workflow", resourceId: workflowId, level: "write", principalTier: "serviceAccount" },
      { resourceType: "workflow", resourceId: workflowId, level: "none", principalTier: "user" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, workflowId })).toBe("write");
  });

  test("any deny in user tier beats any allow in same tier", () => {
    // Both grants from user tier (e.g. duplicate auth.access rows)
    const grants: Grant[] = [
      { resourceType: "table", resourceId: tableId, level: "read", principalTier: "user" },
      { resourceType: "table", resourceId: tableId, level: "none", principalTier: "user" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("none");
  });

  test("any deny in group tier beats allow when no user-tier grant exists", () => {
    const grants: Grant[] = [
      { resourceType: "table", resourceId: tableId, level: "read", principalTier: "group" },
      { resourceType: "table", resourceId: tableId, level: "none", principalTier: "group" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("none");
  });

  test("group tier deny is shadowed by user tier allow (user is more specific)", () => {
    const grants: Grant[] = [
      { resourceType: "table", resourceId: tableId, level: "read", principalTier: "user" },
      { resourceType: "table", resourceId: tableId, level: "none", principalTier: "group" },
    ];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("read");
  });

  test("authenticated tier visible only when no user/group grants", () => {
    const grants: Grant[] = [{ resourceType: "table", resourceId: tableId, level: "read", principalTier: "authenticated" }];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("read");
  });

  test("public tier is the last fallback within a resource scope", () => {
    const grants: Grant[] = [{ resourceType: "table", resourceId: tableId, level: "read", principalTier: "public" }];
    expect(resolveEffectivePermission(grants, { baseId, tableId })).toBe("read");
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
