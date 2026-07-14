import { describe, expect, test } from "bun:test";
import { resolveSpaceApiKeyPermission } from "./access";
import { checkOverlap, listCalendar, searchAcross } from "./items";
import { list as listSpaces } from "./spaces";

const resourceSubject = {
  type: "service_account" as const,
  serviceAccountId: "11111111-1111-4111-8111-111111111111",
};

describe("resolveSpaceApiKeyPermission", () => {
  test("caps credential scopes by the resource access permission", () => {
    expect(resolveSpaceApiKeyPermission("admin", ["read"])).toBe("read");
    expect(resolveSpaceApiKeyPermission("admin", ["write"])).toBe("write");
    expect(resolveSpaceApiKeyPermission("write", ["admin"])).toBe("write");
    expect(resolveSpaceApiKeyPermission("read", ["admin"])).toBe("read");
  });

  test("uses the strongest credential scope and denies credentials without usable scopes", () => {
    expect(resolveSpaceApiKeyPermission("admin", ["read", "write"])).toBe("write");
    expect(resolveSpaceApiKeyPermission("admin", [])).toBe("none");
    expect(resolveSpaceApiKeyPermission("none", ["admin"])).toBe("none");
  });
});

test("resource service-account collections fail closed without a valid space binding", async () => {
  expect(await listSpaces({ subject: resourceSubject })).toEqual([]);
  expect(await searchAcross({ subject: resourceSubject, query: "test", kinds: "all", limit: 10 })).toEqual([]);
  expect(await listCalendar({ subject: resourceSubject, from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" })).toEqual([]);
  expect(await checkOverlap({ subject: resourceSubject, from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" })).toEqual([]);
});
