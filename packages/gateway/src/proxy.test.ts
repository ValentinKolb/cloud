import { describe, expect, test } from "bun:test";
import { redactSensitivePath } from "./proxy";

describe("gateway path redaction", () => {
  test("redacts public Mail attachment tokens without changing unrelated paths", () => {
    expect(redactSensitivePath("/share/mail/attachments/secret-token")).toBe("/share/mail/attachments/[REDACTED]");
    expect(redactSensitivePath("/api/mail/public-attachments/secret-token/download")).toBe(
      "/api/mail/public-attachments/[REDACTED]/download",
    );
    expect(redactSensitivePath("/app/mail/a/secret-token")).toBe("/app/mail/a/[REDACTED]");
    expect(redactSensitivePath("/app/mail/inbox")).toBe("/app/mail/inbox");
  });
});
