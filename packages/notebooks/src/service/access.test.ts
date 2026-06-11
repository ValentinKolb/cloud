import { describe, expect, test } from "bun:test";
import { resolveNotebookApiKeyPermission } from "./access";

describe("resolveNotebookApiKeyPermission", () => {
  test("caps credential scopes by service account access", () => {
    expect(resolveNotebookApiKeyPermission("admin", ["read"])).toBe("read");
    expect(resolveNotebookApiKeyPermission("admin", ["write"])).toBe("write");
    expect(resolveNotebookApiKeyPermission("write", ["admin"])).toBe("write");
    expect(resolveNotebookApiKeyPermission("read", ["admin"])).toBe("read");
  });

  test("handles multiple or missing credential scopes", () => {
    expect(resolveNotebookApiKeyPermission("admin", ["read", "write"])).toBe("write");
    expect(resolveNotebookApiKeyPermission("admin", [])).toBe("none");
    expect(resolveNotebookApiKeyPermission("none", ["admin"])).toBe("none");
  });
});
