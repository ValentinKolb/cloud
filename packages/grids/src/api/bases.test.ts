import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type { MiddlewareHandler } from "hono";

const user: User = {
  id: "11111111-1111-4111-8111-111111111111",
  uid: "platform-admin",
  roles: ["admin", "user", "local", "local/user"],
  provider: "local",
  profile: "user",
  givenname: "Platform",
  sn: "Admin",
  displayName: "Platform Admin",
  mail: null,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: ["22222222-2222-4222-8222-222222222222"],
  manages: [],
  managesGroupIds: [],
  ipa: null,
};

let listVisibleParams: unknown = null;

mock.module("../service", () => ({
  gridsService: {
    base: {
      listVisible: async (params: unknown) => {
        listVisibleParams = params;
        return { items: [], total: 0 };
      },
    },
  },
}));

const { createBasesApi } = await import("./bases");

const requireAuthenticated: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

describe("Grids bases API", () => {
  beforeEach(() => {
    listVisibleParams = null;
  });

  test("does not pass Cloud admin role as a listVisible bypass", async () => {
    const app = createBasesApi({ requireAuthenticated });

    const response = await app.request("/?q=finance&limit=25&offset=50");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [], total: 0, limit: 25, offset: 50 });
    expect(listVisibleParams).toEqual({
      userId: user.id,
      userGroups: user.memberofGroupIds,
      serviceAccountId: null,
      query: "finance",
      limit: 25,
      offset: 50,
    });
  });
});
