import { describe, expect, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { err, fail } from "@valentinkolb/stdlib";
import type { MiddlewareHandler } from "hono";
import { createWorkspaceApi, parseWorkspaceHref } from "./workspace";

const user: User = {
  id: "11111111-1111-4111-8111-111111111111",
  uid: "workspace-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Workspace",
  sn: "User",
  displayName: "Workspace User",
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

const authenticated: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

describe("parseWorkspaceHref", () => {
  test("accepts the base and query workspace routes", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc")).toMatchObject({ baseShortId: "hNTsc" });
    expect(parseWorkspaceHref("/app/grids/hNTsc/query?table=tbl123")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: null,
    });
  });

  test("accepts table and view workspace routes", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: null,
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/query")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: null,
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/view/view456")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: "view456",
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/view/view456/query")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: "view456",
    });
  });

  test("accepts dashboard and document workspace routes", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/dashboard/dash123")).toMatchObject({
      baseShortId: "hNTsc",
      activeDashboardSlug: "dash123",
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/document/tbl123/tpl456")).toMatchObject({
      baseShortId: "hNTsc",
      activeDocumentTableSlug: "tbl123",
      activeDocumentTemplateSlug: "tpl456",
    });
  });

  test("accepts workflow overview routes with edit mode", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/workflows?edit=true")).toEqual({
      baseShortId: "hNTsc",
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeWorkflowSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    });
  });

  test("accepts workflow detail routes with edit mode", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/workflows/wf123?edit=true")).toEqual({
      baseShortId: "hNTsc",
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeWorkflowSlug: "wf123",
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    });
  });

  test("rejects removed automation routes", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/automations?edit=true")).toBeNull();
  });

  test("rejects removed scanner routes", () => {
    expect(parseWorkspaceHref("/app/grids/scan")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/workflows/wf123/scan")).toBeNull();
  });

  test("rejects incomplete, trailing, and non-workspace paths", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/table")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/view")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/dashboard")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/document/tbl123")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/query/extra")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/reference")).toBeNull();
    expect(parseWorkspaceHref("/app/notebooks/hNTsc")).toBeNull();
  });
});

describe("Grids workspace route", () => {
  test("checks base access before loading workspace state without revealing base existence", async () => {
    let loadCalls = 0;
    const deniedApp = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getBaseByShortId: async () => ({ id: "22222222-2222-4222-8222-222222222222" }) as never,
      gate: async () => fail(err.forbidden("Base access denied")),
      loadState: async () => {
        loadCalls += 1;
        return {} as never;
      },
    });
    const missingApp = createWorkspaceApi({
      requireAuthenticated: authenticated,
      getBaseByShortId: async () => null,
      gate: async () => {
        throw new Error("Gate must not run for a missing base");
      },
      loadState: async () => {
        loadCalls += 1;
        return {} as never;
      },
    });

    const href = encodeURIComponent("/app/grids/hNTsc");
    const deniedResponse = await deniedApp.request(`/route?href=${href}`);
    const missingResponse = await missingApp.request(`/route?href=${href}`);

    expect(deniedResponse.status).toBe(404);
    expect(await deniedResponse.json()).toEqual({ message: "Base not found" });
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({ message: "Base not found" });
    expect(loadCalls).toBe(0);
  });
});
