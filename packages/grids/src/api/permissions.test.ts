import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { gridsService } from "../service";
import {
  currentActorUserId,
  currentActorViewer,
  currentResourceBoundBaseId,
  gateAt,
  gateCredentialScope,
  resolveBaseWithGrantsForAccess,
  resolveCustomAppWithGrantsForAccess,
  gridsAccessContext,
} from "./permissions";

let resolvedLevel: "none" | "read" | "write" | "admin" = "none";
let lastBaseLoad: unknown = null;
let lastAppLoad: unknown = null;

const baseId = "22222222-2222-4222-8222-222222222222";
const customAppId = "33333333-3333-4333-8333-333333333333";
const user = { id: "11111111-1111-4111-8111-111111111111", roles: ["admin", "user"], memberofGroupIds: [] };
const userContext = {
  get: (key: string) => {
    if (key === "actor") return { kind: "user", user };
    if (key === "accessSubject") return { type: "user", userId: user.id };
    return undefined;
  },
};
const resourceServiceAccount = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Grids API",
  kind: "resource_bound",
  status: "active",
  delegatedUserId: null,
  appId: "grids",
  resourceType: "base",
  resourceId: baseId,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const serviceAccountContext = {
  get: (key: string) => {
    if (key === "actor") {
      return { kind: "service_account", serviceAccount: resourceServiceAccount, delegatedUser: null, scopes: ["grids:read"] };
    }
    if (key === "accessSubject") return { type: "service_account", serviceAccountId: resourceServiceAccount.id };
    return undefined;
  },
};

describe("Grids API permissions", () => {
  beforeEach(() => {
    lastBaseLoad = null;
    lastAppLoad = null;
    spyOn(gridsService.permission, "loadBaseGrantsForSubject").mockImplementation(async (params) => {
      lastBaseLoad = params;
      return [];
    });
    spyOn(gridsService.permission, "loadCustomAppGrantsForSubject").mockImplementation(async (params) => {
      lastAppLoad = params;
      return [];
    });
    spyOn(gridsService.permission, "resolve").mockImplementation(() => resolvedLevel);
  });

  afterEach(() => mock.restore());

  test("Cloud roles do not bypass base grants", async () => {
    resolvedLevel = "none";
    expect((await gateAt(userContext as never, { baseId }, "read")).ok).toBe(false);
  });

  test("loads only the exact base grant and applies its level", async () => {
    resolvedLevel = "write";
    const resolved = await resolveBaseWithGrantsForAccess(gridsAccessContext(userContext as never), baseId);
    expect(resolved.level).toBe("write");
    expect(lastBaseLoad).toEqual({ baseId, subject: { type: "user", userId: user.id } });
    expect(lastAppLoad).toBeNull();
  });

  test("loads Grids App grants independently from base grants", async () => {
    resolvedLevel = "read";
    const resolved = await resolveCustomAppWithGrantsForAccess(gridsAccessContext(userContext as never), customAppId);
    expect(resolved.level).toBe("read");
    expect(lastAppLoad).toEqual({ customAppId, subject: { type: "user", userId: user.id } });
    expect(lastBaseLoad).toBeNull();
  });

  test("resource-bound credentials are capped and cannot cross bases or enter Grids Apps", async () => {
    resolvedLevel = "admin";
    expect(currentResourceBoundBaseId(serviceAccountContext as never)).toBe(baseId);
    expect((await gateAt(serviceAccountContext as never, { baseId }, "read")).ok).toBe(true);
    expect((await gateAt(serviceAccountContext as never, { baseId }, "write")).ok).toBe(false);
    expect((await gateAt(serviceAccountContext as never, { baseId: customAppId }, "read")).ok).toBe(false);
    expect((await gateCredentialScope(serviceAccountContext as never, "write")).ok).toBe(false);
    expect((await resolveCustomAppWithGrantsForAccess(gridsAccessContext(serviceAccountContext as never), customAppId)).level).toBe("none");
  });

  test("preserves actor identity for audit and relation display", () => {
    expect(currentActorUserId(userContext as never)).toBe(user.id);
    expect(currentActorViewer(serviceAccountContext as never)).toEqual({
      userId: null,
      userGroups: [],
      serviceAccountId: resourceServiceAccount.id,
    });
  });
});
