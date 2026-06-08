import { describe, expect, test } from "bun:test";
import { canMutateManagedGroup, hasOnlySelfUpdateFields, isAdminActor, isSelfTarget, type AccountsActor } from "./authz";

const actor = (overrides: Partial<AccountsActor> = {}): AccountsActor => ({
  userId: "user-1",
  uid: "eva",
  roles: ["user", "local/user"],
  provider: "local",
  ...overrides,
});

describe("accounts service authorization helpers", () => {
  test("recognizes admin actors from roles", () => {
    expect(isAdminActor(actor({ roles: ["user", "admin"] }))).toBe(true);
    expect(isAdminActor(actor({ roles: ["user", "group-manager"] }))).toBe(false);
    expect(isAdminActor(null)).toBe(false);
  });

  test("recognizes self-service targets by user id", () => {
    expect(isSelfTarget({ actor: actor({ userId: "user-1" }), targetUserId: "user-1" })).toBe(true);
    expect(isSelfTarget({ actor: actor({ userId: "user-1" }), targetUserId: "user-2" })).toBe(false);
    expect(isSelfTarget({ actor: null, targetUserId: "user-1" })).toBe(false);
  });

  test("allows managed group mutations for admins or recursive managers only", () => {
    expect(
      canMutateManagedGroup({
        actor: actor({ roles: ["admin"] }),
        groupId: "group-1",
        managedGroupIds: [],
      }),
    ).toBe(true);

    expect(
      canMutateManagedGroup({
        actor: actor({ roles: ["user", "group-manager"] }),
        groupId: "group-1",
        managedGroupIds: ["group-1", "child-group"],
      }),
    ).toBe(true);

    expect(
      canMutateManagedGroup({
        actor: actor({ roles: ["user", "group-manager"] }),
        groupId: "group-1",
        managedGroupIds: ["other-group"],
      }),
    ).toBe(false);

    expect(canMutateManagedGroup({ actor: null, groupId: "group-1", managedGroupIds: ["group-1"] })).toBe(false);
  });

  test("rejects managed group mutations for stale or guest manager relations", () => {
    expect(
      canMutateManagedGroup({
        actor: actor({ roles: ["guest", "local/guest"] }),
        groupId: "group-1",
        managedGroupIds: ["group-1"],
      }),
    ).toBe(false);

    expect(
      canMutateManagedGroup({
        actor: actor({ roles: ["user", "local/user"] }),
        groupId: "group-1",
        managedGroupIds: ["group-1"],
      }),
    ).toBe(false);
  });

  test("allows only self-service profile fields for self updates", () => {
    expect(hasOnlySelfUpdateFields({ givenname: "Eva", sn: "Becker", displayName: "Eva Becker" })).toBe(true);
    expect(hasOnlySelfUpdateFields({ ipa: { phone: "+49" } })).toBe(true);
    expect(hasOnlySelfUpdateFields({ mail: "eva@example.com" })).toBe(false);
    expect(hasOnlySelfUpdateFields({ givenname: "Eva", mail: "eva@example.com" })).toBe(false);
  });
});
