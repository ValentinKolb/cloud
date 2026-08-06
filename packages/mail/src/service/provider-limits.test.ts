import { describe, expect, test } from "bun:test";
import { PROVIDER_LIMIT_MAX_AGE_MS, type ProviderLimitSnapshot, providerLimitSnapshotSchema } from "../contracts";
import { activeSmtpMessageLimit, assertProviderMessageSize } from "./provider-limits";

const snapshot = (checkedAt: string, maxMessageBytes: number | null = 25_000_000): ProviderLimitSnapshot => ({
  checkedAt,
  imap: { status: "supported", storage: null, messages: null },
  smtp: { status: "supported", maxMessageBytes, dsn: false },
});

describe("provider limits", () => {
  test("validates bounded provider evidence", () => {
    expect(providerLimitSnapshotSchema.safeParse(snapshot("2026-07-24T10:00:00.000Z")).success).toBe(true);
    expect(
      providerLimitSnapshotSchema.safeParse({
        ...snapshot("2026-07-24T10:00:00.000Z"),
        smtp: { status: "supported", maxMessageBytes: 0, dsn: false },
      }).success,
    ).toBe(false);
    expect(
      providerLimitSnapshotSchema.safeParse({
        ...snapshot("2026-07-24T10:00:00.000Z"),
        smtp: { status: "unsupported", maxMessageBytes: 25_000_000, dsn: false },
      }).success,
    ).toBe(false);
  });

  test("only enforces current numeric SMTP limits", () => {
    const now = Date.parse("2026-07-24T10:00:00.000Z");
    expect(activeSmtpMessageLimit(snapshot(new Date(now).toISOString()), now)).toBe(25_000_000);
    expect(activeSmtpMessageLimit(snapshot(new Date(now - PROVIDER_LIMIT_MAX_AGE_MS - 1).toISOString()), now)).toBeNull();
    expect(activeSmtpMessageLimit(snapshot(new Date(now).toISOString(), null), now)).toBeNull();
    expect(
      activeSmtpMessageLimit(
        {
          ...snapshot(new Date(now).toISOString()),
          smtp: { status: "unsupported", maxMessageBytes: null, dsn: false },
        },
        now,
      ),
    ).toBeNull();
  });

  test("rejects only payloads above a known limit", () => {
    expect(() => assertProviderMessageSize(1_000, 1_000)).not.toThrow();
    expect(() => assertProviderMessageSize(1_001, 1_000)).toThrow(
      expect.objectContaining({
        code: "MESSAGE_EXCEEDS_PROVIDER_LIMIT",
        byteLength: 1_001,
        limitBytes: 1_000,
      }),
    );
    expect(() => assertProviderMessageSize(Number.MAX_SAFE_INTEGER, null)).not.toThrow();
  });
});
