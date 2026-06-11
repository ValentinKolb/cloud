import { describe, expect, test } from "bun:test";
import { resolveSpaceApiKeyPermission } from "./access";

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
