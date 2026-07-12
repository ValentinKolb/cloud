import { describe, expect, test } from "bun:test";
import { canAdministerView, changesViewSharing } from "./views";

describe("view mutation policy", () => {
  test("treats an owner without an overriding view ACL as implicit admin", () => {
    expect(canAdministerView({ level: "read", isOwner: true, hasDirectViewGrant: false })).toBe(true);
  });

  test("honors a direct read-only view ACL for the owner", () => {
    expect(canAdministerView({ level: "read", isOwner: true, hasDirectViewGrant: true })).toBe(false);
  });

  test("requires explicit or inherited admin for non-owners", () => {
    expect(canAdministerView({ level: "read", isOwner: false, hasDirectViewGrant: true })).toBe(false);
    expect(canAdministerView({ level: "admin", isOwner: false, hasDirectViewGrant: true })).toBe(true);
  });

  test("does not preserve implicit owner admin after inherited access is revoked", () => {
    expect(canAdministerView({ level: "none", isOwner: true, hasDirectViewGrant: false })).toBe(false);
  });

  test("requires a separate gate only when shared visibility actually changes", () => {
    expect(changesViewSharing(true, "owner-id")).toBe(true);
    expect(changesViewSharing(false, null)).toBe(true);
    expect(changesViewSharing(false, "owner-id")).toBe(false);
    expect(changesViewSharing(undefined, null)).toBe(false);
  });
});
