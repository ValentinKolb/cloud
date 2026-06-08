import { describe, expect, test } from "bun:test";
import { sanitizeAuditMetadata, sanitizeAuditText } from "./index";

describe("sanitizeAuditMetadata", () => {
  test("redacts sensitive nested metadata keys", () => {
    expect(
      sanitizeAuditMetadata({
        changedFields: ["mail"],
        password: "secret",
        nested: {
          apiToken: "token",
          ipaSession: "cookie",
          safe: "value",
        },
      }),
    ).toEqual({
      changedFields: ["mail"],
      password: "[REDACTED]",
      nested: {
        apiToken: "[REDACTED]",
        ipaSession: "[REDACTED]",
        safe: "value",
      },
    });
  });

  test("truncates large values and arrays", () => {
    const sanitized = sanitizeAuditMetadata({
      text: "x".repeat(510),
      values: Array.from({ length: 52 }, (_, index) => index),
    }) as Record<string, unknown>;

    expect(sanitized.text).toBe(`${"x".repeat(500)}...`);
    expect(sanitized.values).toEqual([...Array.from({ length: 50 }, (_, index) => index), "[2 more]"]);
  });

  test("redacts sensitive reason and error text", () => {
    expect(sanitizeAuditText("IPA session required to update IPA-backed users")).toBe("[REDACTED]");
    expect(sanitizeAuditText("Current password is incorrect.")).toBe("[REDACTED]");
    expect(sanitizeAuditText("Access denied")).toBe("Access denied");
  });
});
