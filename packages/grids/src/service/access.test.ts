import { describe, expect, test } from "bun:test";
import { type AccessBinding, buildAccessAuditDiff } from "./access";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCESS_ID = "22222222-2222-4222-8222-222222222222";

describe("access audit diff", () => {
  test("captures a new table grant with stable resource and principal data", () => {
    const binding: AccessBinding = {
      resourceType: "table",
      baseId: "33333333-3333-4333-8333-333333333333",
      tableId: "44444444-4444-4444-8444-444444444444",
    };

    expect(
      buildAccessAuditDiff(
        "access.granted",
        binding,
        {
          id: ACCESS_ID,
          user_id: USER_ID,
          group_id: null,
          service_account_id: null,
          authenticated_only: false,
          permission: "read",
        },
        "read",
      ),
    ).toEqual({
      access: {
        old: null,
        new: {
          id: ACCESS_ID,
          resourceType: "table",
          resourceId: "44444444-4444-4444-8444-444444444444",
          principal: { type: "user", userId: USER_ID },
          permission: "read",
        },
      },
    });
  });

  test("captures permission changes without changing the principal", () => {
    const binding: AccessBinding = {
      resourceType: "form",
      baseId: "33333333-3333-4333-8333-333333333333",
      tableId: "44444444-4444-4444-8444-444444444444",
      formId: "55555555-5555-4555-8555-555555555555",
    };

    expect(
      buildAccessAuditDiff(
        "access.updated",
        binding,
        {
          id: ACCESS_ID,
          user_id: null,
          group_id: null,
          service_account_id: null,
          authenticated_only: true,
          permission: "write",
        },
        "none",
      ),
    ).toEqual({
      access: {
        old: {
          id: ACCESS_ID,
          resourceType: "form",
          resourceId: "55555555-5555-4555-8555-555555555555",
          principal: { type: "authenticated" },
          permission: "write",
        },
        new: {
          id: ACCESS_ID,
          resourceType: "form",
          resourceId: "55555555-5555-4555-8555-555555555555",
          principal: { type: "authenticated" },
          permission: "none",
        },
      },
    });
  });

  test("captures revoked group access with a null new value", () => {
    const binding: AccessBinding = {
      resourceType: "base",
      baseId: "33333333-3333-4333-8333-333333333333",
    };

    expect(
      buildAccessAuditDiff(
        "access.revoked",
        binding,
        {
          id: ACCESS_ID,
          user_id: null,
          group_id: "66666666-6666-4666-8666-666666666666",
          service_account_id: null,
          authenticated_only: false,
          permission: "admin",
        },
        null,
      ),
    ).toEqual({
      access: {
        old: {
          id: ACCESS_ID,
          resourceType: "base",
          resourceId: "33333333-3333-4333-8333-333333333333",
          principal: { type: "group", groupId: "66666666-6666-4666-8666-666666666666" },
          permission: "admin",
        },
        new: null,
      },
    });
  });
});
