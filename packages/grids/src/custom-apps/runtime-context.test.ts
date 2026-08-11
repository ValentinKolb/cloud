import { describe, expect, test } from "bun:test";
import type { CustomAppDefinition } from "./contracts";
import { buildCustomAppRuntimeContext, customAppDefinitionWithAvailableNavigation } from "./runtime-context";

const common = {
  app: { id: "019fa000-0000-7000-8000-000000000001", shortId: "APP1", name: "Loans" },
  base: { id: "019fa000-0000-7000-8000-000000000002", name: "Inventory" },
  page: { id: "mine", title: "My loans" },
  pageUrl: "/apps/APP1/mine?state=open",
  pageParams: { state: "open" },
  dateConfig: { timeZone: "Europe/Berlin" },
  now: new Date("2026-08-10T22:30:00.000Z"),
};

describe("Grids App runtime context", () => {
  test("captures the complete implicit context and local date once", () => {
    const context = buildCustomAppRuntimeContext({
      ...common,
      access: {
        actor: {
          kind: "user",
          user: {
            id: "019fa000-0000-7000-8000-000000000003",
            uid: "reader",
            roles: ["user"],
            provider: "local",
            profile: "user",
            givenname: "App",
            sn: "Reader",
            displayName: "App Reader",
            mail: "reader@example.test",
            avatarHash: null,
            accountExpires: null,
            lastLoginLocal: null,
            memberofGroup: [],
            memberofGroupIds: [],
            manages: [],
            managesGroupIds: [],
            ipa: null,
          },
        },
        accessSubject: { type: "user", userId: "019fa000-0000-7000-8000-000000000003" },
      },
    });

    expect(context.now).toBe(common.now);
    expect(context.query).toEqual({
      "auth.id": "019fa000-0000-7000-8000-000000000003",
      "auth.name": "App Reader",
      "auth.username": "reader",
      "auth.email": "reader@example.test",
      "params.state": "open",
      "page.id": "mine",
      "page.title": "My loans",
      "page.url": "/apps/APP1/mine?state=open",
      "app.id": "019fa000-0000-7000-8000-000000000001",
      "app.shortId": "APP1",
      "app.name": "Loans",
      "base.id": "019fa000-0000-7000-8000-000000000002",
      "base.name": "Inventory",
      "time.now": "2026-08-10T22:30:00.000Z",
      "time.today": "2026-08-11",
      "time.timeZone": "Europe/Berlin",
    });
  });

  test("uses null auth identity for anonymous requests", () => {
    const query = buildCustomAppRuntimeContext({ ...common, access: { actor: undefined, accessSubject: null } }).query;
    expect(query["auth.id"]).toBeNull();
    expect(query["auth.name"]).toBeNull();
    expect(query["auth.username"]).toBeNull();
    expect(query["auth.email"]).toBeNull();
  });

  test("removes unavailable navigation pages but retains route-only targets", () => {
    const block = (id: string) => ({ id, type: "markdown" as const, markdown: id });
    const page = (id: string, visible: boolean) => ({
      id,
      title: id,
      navigation: { visible, order: 0 },
      parameters: {},
      rows: [{ id: `${id}-row`, columns: [{ id: `${id}-column`, span: 12, blocks: [block(`${id}-block`)] }] }],
    });
    const definition: CustomAppDefinition = {
      schemaVersion: 2,
      kind: "grids.custom-app",
      id: common.app.id,
      baseId: common.base.id,
      name: common.app.name,
      startPageId: "home",
      pages: [page("home", true), page("restricted", true), page("details", false)],
    };

    expect(customAppDefinitionWithAvailableNavigation(definition, new Set(["home"])).pages.map((item) => item.id)).toEqual([
      "home",
      "details",
    ]);
  });
});
