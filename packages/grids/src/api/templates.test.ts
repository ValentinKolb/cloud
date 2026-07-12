import { describe, expect, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type { MiddlewareHandler } from "hono";
import { createTemplatesApi } from "./templates";

const user: User = {
  id: "11111111-1111-4111-8111-111111111111",
  uid: "template-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Template",
  sn: "User",
  displayName: "Template User",
  mail: null,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
};

const resourceServiceAccount = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Grids base API",
  kind: "resource_bound" as const,
  status: "active" as const,
  delegatedUserId: null,
  appId: "grids",
  resourceType: "base",
  resourceId: "33333333-3333-4333-8333-333333333333",
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const requireDelegatedRead: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", {
    kind: "service_account",
    serviceAccount: {
      ...resourceServiceAccount,
      kind: "user_delegated",
      delegatedUserId: user.id,
      appId: null,
      resourceType: null,
      resourceId: null,
    },
    delegatedUser: user,
    scopes: ["read"],
  });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

const requireResourceBound: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", { kind: "service_account", serviceAccount: resourceServiceAccount, delegatedUser: null, scopes: ["grids:*"] });
  c.set("accessSubject", { type: "service_account", serviceAccountId: resourceServiceAccount.id });
  await next();
};

const instantiate = (requireAuthenticated: MiddlewareHandler<AuthContext>) =>
  createTemplatesApi({ requireAuthenticated }).request("/bookshop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

describe("Grids template API", () => {
  test("rejects built-in template instantiation without write scope", async () => {
    expect((await instantiate(requireDelegatedRead)).status).toBe(403);
  });

  test("rejects built-in template instantiation from resource-bound credentials", async () => {
    expect((await instantiate(requireResourceBound)).status).toBe(403);
  });
});
