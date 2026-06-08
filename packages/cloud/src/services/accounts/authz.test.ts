import { describe, expect, test } from "bun:test";
import { canMutateManagedGroup, isAdminActor, isSelfTarget, type AccountsActor } from "./authz";

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
        actor: actor({ roles: ["group-manager"] }),
        groupId: "group-1",
        managedGroupIds: ["group-1", "child-group"],
      }),
    ).toBe(true);

    expect(
      canMutateManagedGroup({
        actor: actor({ roles: ["group-manager"] }),
        groupId: "group-1",
        managedGroupIds: ["other-group"],
      }),
    ).toBe(false);

    expect(canMutateManagedGroup({ actor: null, groupId: "group-1", managedGroupIds: ["group-1"] })).toBe(false);
  });
});
