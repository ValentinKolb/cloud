import { describe, expect, test } from "bun:test";
import { mailboxOverviewSubtitle } from "./mail-overview-presentation";

describe("mailboxOverviewSubtitle", () => {
  test("shows the receiving address without redundant active status", () => {
    expect(mailboxOverviewSubtitle({ receivingAddress: "team@example.com", health: "active", healthReason: null })).toBe(
      "team@example.com",
    );
  });

  test("keeps exceptional mailbox health visible", () => {
    expect(mailboxOverviewSubtitle({ receivingAddress: "team@example.com", health: "paused", healthReason: null })).toBe(
      "team@example.com · Mail sync is paused",
    );
  });

  test("explains when no receiving address is configured", () => {
    expect(mailboxOverviewSubtitle({ receivingAddress: null, health: "active", healthReason: null })).toBe(
      "No receiving address configured",
    );
  });
});
