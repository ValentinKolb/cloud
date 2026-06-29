import { describe, expect, mock, test } from "bun:test";

let resolvedLevel: "none" | "read" | "write" | "admin" = "none";

mock.module("../service", () => ({
  gridsService: {
    permission: {
      loadGrants: async () => [],
      resolve: () => resolvedLevel,
      hasAtLeast: (actual: "none" | "read" | "write" | "admin", expected: "none" | "read" | "write" | "admin") => {
        const rank = { none: 0, read: 1, write: 2, admin: 3 };
        return rank[actual] >= rank[expected];
      },
      hasGrantsForResource: () => false,
    },
  },
}));

const { gateAt, resolveWithGrants } = await import("./permissions");

const context = {
  get: (key: string) => {
    if (key !== "user") return undefined;
    return {
      id: "11111111-1111-4111-8111-111111111111",
      roles: ["admin", "user", "local", "local/user"],
      memberofGroupIds: [],
    };
  },
};

describe("Grids API permissions", () => {
  test("Cloud admins do not bypass Grids ACL gates", async () => {
    resolvedLevel = "none";

    const result = await gateAt(context as never, { baseId: "22222222-2222-4222-8222-222222222222" }, "read");

    expect(result.ok).toBe(false);
  });

  test("Cloud admins only get the permission resolved from Grids ACLs", async () => {
    resolvedLevel = "read";

    const result = await resolveWithGrants(context as never, { baseId: "22222222-2222-4222-8222-222222222222" });

    expect(result.level).toBe("read");
    expect(result.grants).toEqual([]);
  });
});
