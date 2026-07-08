import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type { MiddlewareHandler } from "hono";

const baseId = "11111111-1111-4111-8111-111111111111";
const otherBaseId = "22222222-2222-4222-8222-222222222222";
const tableId = "33333333-3333-4333-8333-333333333333";
const baseAccessId = "44444444-4444-4444-8444-444444444444";
const tableAccessId = "55555555-5555-4555-8555-555555555555";
const createdAccessId = "66666666-6666-4666-8666-666666666666";

const user: User = {
  id: "77777777-7777-4777-8777-777777777777",
  uid: "admin-user",
  roles: ["admin", "user", "local", "local/user"],
  provider: "local",
  profile: "user",
  givenname: "Admin",
  sn: "User",
  displayName: "Admin User",
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

const base = {
  id: baseId,
  shortId: "BASE1",
  name: "Admin Base",
  description: null,
  documentProfile: {},
  createdBy: user.id,
  defaultDashboardId: null,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseEntry = {
  id: baseAccessId,
  principal: { type: "authenticated" as const },
  permission: "admin" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  resourceType: "base" as const,
  resourceId: baseId,
  resourceName: base.name,
  tableId: null,
  tableName: null,
};

const childEntry = {
  id: tableAccessId,
  principal: { type: "authenticated" as const },
  permission: "none" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  resourceType: "table" as const,
  resourceId: tableId,
  resourceName: "Hidden Table",
  tableId,
  tableName: "Hidden Table",
};

const createdEntry = {
  id: createdAccessId,
  principal: { type: "authenticated" as const },
  permission: "read" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

let isPlatformAdmin = true;
let baseGetCalls = 0;
let grantCalls: unknown[] = [];
let updateCalls: unknown[] = [];
let revokeCalls: unknown[] = [];
let removedBaseId: string | null = null;

mock.module("../service", () => ({
  gridsService: {
    base: {
      get: async (id: string) => {
        baseGetCalls += 1;
        return id === baseId ? base : null;
      },
      remove: async (id: string, actorId: string) => {
        removedBaseId = `${id}:${actorId}`;
        return { ok: true };
      },
    },
    access: {
      listForBaseTree: async () => [baseEntry, childEntry],
      listForBase: async () => [createdEntry],
      grant: async (params: unknown) => {
        grantCalls.push(params);
        return { ok: true, data: { accessId: createdAccessId } };
      },
      resolveBinding: async (accessId: string) => {
        if (accessId === baseAccessId) return { resourceType: "base", baseId };
        if (accessId === tableAccessId) return { resourceType: "table", baseId, tableId };
        return { resourceType: "base", baseId: otherBaseId };
      },
      updateLevel: async (...args: unknown[]) => {
        updateCalls.push(args);
        return { ok: true };
      },
      revoke: async (...args: unknown[]) => {
        revokeCalls.push(args);
        return { ok: true };
      },
    },
  },
}));

const { createAdminApi } = await import("./admin");

const requireAdmin: MiddlewareHandler<AuthContext> = async (c, next) => {
  if (!isPlatformAdmin) return c.json({ message: "Forbidden" }, 403);
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

const app = () => createAdminApi({ requireAdmin });

const jsonRequest = (method: "POST" | "PATCH", body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Grids admin API", () => {
  beforeEach(() => {
    isPlatformAdmin = true;
    baseGetCalls = 0;
    grantCalls = [];
    updateCalls = [];
    revokeCalls = [];
    removedBaseId = null;
  });

  test("rejects non-platform-admin callers before reading base data", async () => {
    isPlatformAdmin = false;

    const response = await app().request(`/bases/${baseId}/access`);

    expect(response.status).toBe(403);
    expect(baseGetCalls).toBe(0);
  });

  test("lists base and child ACL entries for platform admins", async () => {
    const response = await app().request(`/bases/${baseId}/access`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([baseEntry, childEntry]);
  });

  test("creates base grants and returns the created access entry", async () => {
    const response = await app().request(
      `/bases/${baseId}/access`,
      jsonRequest("POST", { principal: { type: "authenticated" }, permission: "read" }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(createdEntry);
    expect(grantCalls).toEqual([
      {
        resourceType: "base",
        resourceId: baseId,
        actorId: user.id,
        principal: { type: "authenticated" },
        permission: "read",
      },
    ]);
  });

  test("can update child ACLs inside the requested base", async () => {
    const response = await app().request(`/bases/${baseId}/access/${tableAccessId}`, jsonRequest("PATCH", { permission: "read" }));

    expect(response.status).toBe(204);
    expect(updateCalls).toEqual([[tableAccessId, "read", user.id]]);
  });

  test("rejects invalid child ACL levels in the admin repair route", async () => {
    const response = await app().request(`/bases/${baseId}/access/${tableAccessId}`, jsonRequest("PATCH", { permission: "admin" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: "Table grants only accept 'read' / 'write' / 'none'" });
    expect(updateCalls).toEqual([]);
  });

  test("does not update ACLs from another base", async () => {
    const response = await app().request(
      `/bases/${baseId}/access/99999999-9999-4999-8999-999999999999`,
      jsonRequest("PATCH", { permission: "read" }),
    );

    expect(response.status).toBe(404);
    expect(updateCalls).toEqual([]);
  });

  test("can revoke child ACLs inside the requested base", async () => {
    const response = await app().request(`/bases/${baseId}/access/${tableAccessId}`, { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(revokeCalls).toEqual([[tableAccessId, user.id]]);
  });

  test("deletes bases only through the admin route", async () => {
    const response = await app().request(`/bases/${baseId}`, { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(removedBaseId).toBe(`${baseId}:${user.id}`);
  });
});
