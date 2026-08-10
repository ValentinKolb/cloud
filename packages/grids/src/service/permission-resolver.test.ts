import { describe, expect, test } from "bun:test";
import type { Grant } from "./permission-resolver";
import { hasAtLeast, resolveEffectivePermission } from "./permission-resolver";

const baseId = "11111111-1111-4111-8111-111111111111";
const customAppId = "22222222-2222-4222-8222-222222222222";
const grant = (input: Partial<Grant> & Pick<Grant, "resourceType" | "resourceId" | "level">): Grant => ({
  principalTier: "user",
  ...input,
});

describe("resolveEffectivePermission", () => {
  test("resolves an exact base without considering Custom App grants", () => {
    const grants: Grant[] = [
      grant({ resourceType: "base", resourceId: baseId, level: "write" }),
      grant({ resourceType: "customApp", resourceId: customAppId, level: "read" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId })).toBe("write");
  });

  test("resolves an exact Custom App without falling back to its base", () => {
    const grants: Grant[] = [grant({ resourceType: "base", resourceId: baseId, level: "admin" })];
    expect(resolveEffectivePermission(grants, { customAppId })).toBe("none");
  });

  test("uses the first matching principal tier and deny wins inside that tier", () => {
    const grants: Grant[] = [
      grant({ resourceType: "base", resourceId: baseId, level: "read", principalTier: "user" }),
      grant({ resourceType: "base", resourceId: baseId, level: "none", principalTier: "user" }),
      grant({ resourceType: "base", resourceId: baseId, level: "admin", principalTier: "group" }),
    ];
    expect(resolveEffectivePermission(grants, { baseId })).toBe("none");
  });

  test("supports public Custom App grants", () => {
    const grants: Grant[] = [
      grant({ resourceType: "customApp", resourceId: customAppId, level: "read", principalTier: "public" }),
    ];
    expect(resolveEffectivePermission(grants, { customAppId })).toBe("read");
  });
});

test("hasAtLeast follows the Cloud permission order", () => {
  expect(hasAtLeast("admin", "write")).toBe(true);
  expect(hasAtLeast("read", "write")).toBe(false);
});
