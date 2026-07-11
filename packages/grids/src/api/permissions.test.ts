import { describe, expect, mock, test } from "bun:test";

let resolvedLevel: "none" | "read" | "write" | "admin" = "none";
let lastLoadGrantsParams: unknown = null;

mock.module("../service", () => ({
  gridsService: {
    permission: {
      loadGrants: async (params: unknown) => {
        lastLoadGrantsParams = params;
        return [];
      },
      resolve: () => resolvedLevel,
      hasAtLeast: (actual: "none" | "read" | "write" | "admin", expected: "none" | "read" | "write" | "admin") => {
        const rank = { none: 0, read: 1, write: 2, admin: 3 };
        return rank[actual] >= rank[expected];
      },
      hasGrantsForResource: () => false,
    },
  },
}));

const { currentActorUserId, currentActorViewer, gateAt, resolveWithGrants } = await import("./permissions");

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  roles: ["admin", "user", "local", "local/user"],
  memberofGroupIds: ["33333333-3333-4333-8333-333333333333"],
};

const serviceAccount = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Grids workflow",
  kind: "resource_bound",
  status: "active",
  delegatedUserId: null,
  appId: "grids",
  resourceType: "base",
  resourceId: "22222222-2222-4222-8222-222222222222",
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const userContext = {
  get: (key: string) => {
    if (key === "actor") return { kind: "user", user };
    if (key === "accessSubject") return { type: "user", userId: user.id };
    return undefined;
  },
};

const serviceAccountContext = {
  get: (key: string) => {
    if (key === "actor") return { kind: "service_account", serviceAccount, delegatedUser: null, scopes: ["grids:*"] };
    if (key === "accessSubject") return { type: "service_account", serviceAccountId: serviceAccount.id };
    return undefined;
  },
};

const delegatedServiceAccountContext = {
  get: (key: string) => {
    if (key === "actor") return { kind: "service_account", serviceAccount, delegatedUser: user, scopes: ["grids:*"] };
    if (key === "accessSubject") return { type: "user", userId: user.id };
    return undefined;
  },
};

describe("Grids API permissions", () => {
  test("Cloud admins do not bypass Grids ACL gates", async () => {
    resolvedLevel = "none";

    const result = await gateAt(userContext as never, { baseId: "22222222-2222-4222-8222-222222222222" }, "read");

    expect(result.ok).toBe(false);
  });

  test("Cloud admins only get the permission resolved from Grids ACLs", async () => {
    resolvedLevel = "read";

    const result = await resolveWithGrants(userContext as never, { baseId: "22222222-2222-4222-8222-222222222222" });

    expect(result.level).toBe("read");
    expect(result.grants).toEqual([]);
  });

  test("resource-bound service accounts resolve through service account grants", async () => {
    resolvedLevel = "read";
    lastLoadGrantsParams = null;

    const result = await gateAt(serviceAccountContext as never, { baseId: "22222222-2222-4222-8222-222222222222" }, "read");

    expect(result.ok).toBe(true);
    expect(currentActorUserId(serviceAccountContext as never)).toBeNull();
    expect(currentActorViewer(serviceAccountContext as never)).toEqual({
      userId: null,
      userGroups: [],
      serviceAccountId: serviceAccount.id,
    });
    expect(lastLoadGrantsParams).toEqual({
      userId: null,
      userGroups: [],
      serviceAccountId: serviceAccount.id,
      baseId: "22222222-2222-4222-8222-222222222222",
      tableId: null,
      viewId: null,
      formId: null,
      documentTemplateId: null,
      dashboardId: null,
      workflowId: null,
    });
  });

  test("delegated service accounts keep both delegated user and service account identities", () => {
    expect(currentActorUserId(delegatedServiceAccountContext as never)).toBe(user.id);
    expect(currentActorViewer(delegatedServiceAccountContext as never)).toEqual({
      userId: user.id,
      userGroups: user.memberofGroupIds,
      serviceAccountId: serviceAccount.id,
    });
  });
});
