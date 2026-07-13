import { describe, expect, test } from "bun:test";
import { DEFAULT_HOME_PATH, resolveHomePath } from "./home";

describe("resolveHomePath", () => {
  test("preserves the current dashboard default", () => {
    expect(resolveHomePath(undefined)).toBe(DEFAULT_HOME_PATH);
    expect(resolveHomePath("")).toBe(DEFAULT_HOME_PATH);
    expect(resolveHomePath("/app/dashboard")).toBe("/app/dashboard");
  });

  test("accepts local user-facing paths", () => {
    expect(resolveHomePath(" /app/custom-home?view=welcome#today ")).toBe("/app/custom-home?view=welcome#today");
    expect(resolveHomePath("/me")).toBe("/me");
  });

  test("rejects external, recursive, auth, and admin targets", () => {
    for (const value of ["https://example.com", "//example.com", "/\\example.com", "/", "/auth/login", "/admin/settings"]) {
      expect(resolveHomePath(value)).toBe(DEFAULT_HOME_PATH);
    }
  });
});
