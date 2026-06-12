import { describe, expect, test } from "bun:test";
import { maxApiKeyPermission, resolveNotebookApiKeyPermission } from "./api-key-permissions";

describe("notebook API key permissions", () => {
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

  test("selects the strongest requested API key permission", () => {
    expect(maxApiKeyPermission(["read", "write"])).toBe("write");
    expect(maxApiKeyPermission(["admin", "read"])).toBe("admin");
    expect(maxApiKeyPermission(["read"])).toBe("read");
  });
});
