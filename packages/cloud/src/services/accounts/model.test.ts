import { describe, expect, test } from "bun:test";
import {
  calculateIpaProfileFromGroupNames,
  deriveIpaAdminFromGroupNames,
  isAccountExpired,
  parseIpaAccountTransitionPolicy,
} from "./model";

describe("IPA account model helpers", () => {
  test("classifies full IPA users from effective base realm groups", () => {
    expect(calculateIpaProfileFromGroupNames(["base-sync", "base-realm"], ["base-realm"])).toBe("user");
  });

  test("classifies in-scope IPA users without base realm as guests", () => {
    expect(calculateIpaProfileFromGroupNames(["base-sync"], ["base-realm"])).toBe("guest");
  });

  test("derives IPA admin from effective groups", () => {
    expect(deriveIpaAdminFromGroupNames(["hidden-admin-transit", "admins"], ["admins"])).toBe(true);
    expect(deriveIpaAdminFromGroupNames(["base-sync"], ["admins"])).toBe(false);
  });

  test("parses all transition policy settings with safe guest demotion fallback", () => {
    expect(parseIpaAccountTransitionPolicy("delete")).toBe("delete");
    expect(parseIpaAccountTransitionPolicy("demote_to_local")).toBe("demote_to_local");
    expect(parseIpaAccountTransitionPolicy("demote_to_local_user")).toBe("demote_to_local_user");
    expect(parseIpaAccountTransitionPolicy("demote_to_local_guest")).toBe("demote_to_local_guest");
    expect(parseIpaAccountTransitionPolicy("unexpected")).toBe("demote_to_local_guest");
    expect(parseIpaAccountTransitionPolicy(null)).toBe("demote_to_local_guest");
  });

  test("treats expired and malformed account expiry as fail-closed", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    expect(isAccountExpired(null, now)).toBe(false);
    expect(isAccountExpired("2026-07-29T12:00:00.001Z", now)).toBe(false);
    expect(isAccountExpired("2026-07-29T12:00:00.000Z", now)).toBe(true);
    expect(isAccountExpired("not-a-date", now)).toBe(true);
  });
});
