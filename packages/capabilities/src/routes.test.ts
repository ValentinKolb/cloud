import { describe, expect, test } from "bun:test";
import { capabilityApiPath, capabilityHref, capabilityPaginationBaseHref } from "./routes";

describe("capability routes", () => {
  test("builds hierarchical playground links", () => {
    expect(capabilityHref({})).toBe("/app/capabilities");
    expect(capabilityHref({ appId: "mail" })).toBe("/app/capabilities/mail");
    expect(capabilityHref({ appId: "mail", kind: "action", capabilityId: "draft.create" })).toBe(
      "/app/capabilities/mail/action/draft.create",
    );
  });

  test("encodes path segments and cursor state", () => {
    expect(capabilityHref({ appId: "demo app", kind: "query", capabilityId: "find/all", cursor: "next app" })).toBe(
      "/app/capabilities/demo%20app/query/find%2Fall?cursor=next+app",
    );
    expect(capabilityApiPath({ appId: "demo app", kind: "query", capabilityId: "find/all" })).toBe(
      "/api/capabilities/v1/queries/demo%20app/find%2Fall",
    );
  });

  test("preserves capability list state on deep links", () => {
    expect(
      capabilityHref({
        appId: "mail",
        kind: "action",
        capabilityId: "draft.create",
        search: "draft mail",
        sort: "id",
        direction: "desc",
        page: 3,
      }),
    ).toBe("/app/capabilities/mail/action/draft.create?search=draft+mail&sort=id&direction=desc&page=3");
  });

  test("builds pagination prefixes without losing list state", () => {
    expect(
      capabilityPaginationBaseHref({
        appId: "mail",
        search: "draft",
        sort: "title",
        direction: "asc",
      }),
    ).toBe("/app/capabilities/mail?search=draft&sort=title&direction=asc&page=");
  });
});
