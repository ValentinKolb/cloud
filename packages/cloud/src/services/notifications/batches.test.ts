import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { __notificationBatchTest } from "./batches";

const canUseDatabase = async () => {
  try {
    const [row] = await sql<{
      users: string | null;
      groups: string | null;
      user_groups: string | null;
      group_manager_users: string | null;
      group_manager_groups: string | null;
    }[]>`
      SELECT
        to_regclass('auth.users')::text AS users,
        to_regclass('auth.groups')::text AS groups,
        to_regclass('auth.user_groups_v2')::text AS user_groups,
        to_regclass('auth.group_manager_users_v2')::text AS group_manager_users,
        to_regclass('auth.group_manager_groups_v2')::text AS group_manager_groups
    `;
    return Boolean(row?.users && row.groups && row.user_groups && row.group_manager_users && row.group_manager_groups);
  } catch {
    return false;
  }
};

const insertUser = async (suffix: string, label: string) => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (
      ${`notification-batch-${label}-${suffix}`},
      'local',
      'user',
      ${`Notification ${label}`},
      ${`notification-batch-${label}-${suffix}@example.test`},
      'Notification',
      ${label}
    )
    RETURNING id
  `;
  return row!.id;
};

const insertGroup = async (suffix: string, label: string) => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.groups (cn, provider, name, description)
    VALUES (${`notification-batch-${label}-${suffix}`}, 'local', ${`Notification ${label} ${suffix}`}, 'notification batch test')
    RETURNING id
  `;
  return row!.id;
};

const cleanupAuthFixture = async (userIds: string[], groupIds: string[]) => {
  for (const groupId of groupIds) {
    await sql`DELETE FROM auth.group_manager_groups_v2 WHERE group_id = ${groupId}::uuid OR manager_group_id = ${groupId}::uuid`;
    await sql`DELETE FROM auth.group_manager_users_v2 WHERE group_id = ${groupId}::uuid`;
    await sql`DELETE FROM auth.user_groups_v2 WHERE group_id = ${groupId}::uuid`;
  }
  for (const groupId of groupIds) {
    await sql`DELETE FROM auth.groups WHERE id = ${groupId}::uuid`;
  }
  for (const userId of userIds) {
    await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
  }
};

describe("notification batch selections", () => {
  test("normalizes duplicate and unordered ids for stable drafts", () => {
    const selection = __notificationBatchTest.normalizeSelection({
      userIds: ["user-b", "user-a", "user-a"],
      groupIds: ["group-b", "group-a"],
      accountManagers: {
        mode: "groups",
        groupIds: ["manager-b", "manager-a", "manager-b"],
      },
      providers: ["ipa", "local", "ipa"],
      profiles: ["guest", "user", "guest"],
    });

    expect(selection.userIds).toEqual(["user-a", "user-b"]);
    expect(selection.groupIds).toEqual(["group-a", "group-b"]);
    expect(selection.accountManagers?.groupIds).toEqual(["manager-a", "manager-b"]);
    expect(selection.providers).toEqual(["ipa", "local"]);
    expect(selection.profiles).toEqual(["guest", "user"]);
  });

  test("defaults recursive member and manager resolution on", () => {
    const selection = __notificationBatchTest.normalizeSelection({});

    expect(selection.includeGroupMembers).toBe(true);
    expect(selection.accountManagers?.mode).toBe("none");
    expect(selection.accountManagers?.recursive).toBe(true);
  });

  test("normalizes modern rule selections", () => {
    const selection = __notificationBatchTest.normalizeSelection({
      mode: "rules",
      rules: ["ipa", "account_manager", "ipa", "guest"],
      groupIds: ["group-b", "group-a", "group-b"],
    });

    expect(selection.mode).toBe("rules");
    expect(selection.rules).toEqual(["account_manager", "guest", "ipa"]);
    expect(selection.groupIds).toEqual(["group-a", "group-b"]);
    expect(selection.includeGroupMembers).toBe(true);
  });

  test("keeps selection hash stable across duplicate and order-only changes", () => {
    const left = __notificationBatchTest.selectionHash({
      userIds: ["user-b", "user-a", "user-a"],
      accountManagers: { mode: "groups", groupIds: ["group-b", "group-a"] },
      providers: ["local", "ipa"],
    });
    const right = __notificationBatchTest.selectionHash({
      providers: ["ipa", "local", "ipa"],
      accountManagers: { groupIds: ["group-a", "group-b"], mode: "groups" },
      userIds: ["user-a", "user-b"],
    });

    expect(left).toBe(right);
  });

  test("hashes deliverable recipients by user id only", () => {
    const left = __notificationBatchTest.recipientHash([
      { id: "user-b", uid: "b", display_name: "B", mail: "b@example.test", provider: "local", profile: "user", source_hits: 1 },
      { id: "user-a", uid: "a", display_name: "A", mail: "a@example.test", provider: "local", profile: "user", source_hits: 1 },
      { id: "user-c", uid: "c", display_name: "C", mail: null, provider: "local", profile: "user", source_hits: 1 },
    ]);
    const right = __notificationBatchTest.recipientHash([
      { id: "user-a", uid: "changed", display_name: "Changed", mail: "changed@example.test", provider: "ipa", profile: "guest", source_hits: 3 },
      { id: "user-b", uid: "b", display_name: "B", mail: "b@example.test", provider: "local", profile: "user", source_hits: 1 },
    ]);

    expect(left).toBe(right);
  });

  test("resolves account managers for scoped groups without requiring group membership", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping notification batch DB test: auth tables are not available.");
      return;
    }

    const suffix = crypto.randomUUID();
    const targetMemberId = await insertUser(suffix, "target-member");
    const directManagerId = await insertUser(suffix, "direct-manager");
    const groupManagerId = await insertUser(suffix, "group-manager");
    const targetGroupId = await insertGroup(suffix, "target-group");
    const managerGroupId = await insertGroup(suffix, "manager-group");
    const userIds = [targetMemberId, directManagerId, groupManagerId];
    const groupIds = [targetGroupId, managerGroupId];

    try {
      await sql`INSERT INTO auth.user_groups_v2 (user_id, group_id) VALUES (${targetMemberId}::uuid, ${targetGroupId}::uuid)`;
      await sql`INSERT INTO auth.user_groups_v2 (user_id, group_id) VALUES (${groupManagerId}::uuid, ${managerGroupId}::uuid)`;
      await sql`INSERT INTO auth.group_manager_users_v2 (group_id, user_id) VALUES (${targetGroupId}::uuid, ${directManagerId}::uuid)`;
      await sql`INSERT INTO auth.group_manager_groups_v2 (group_id, manager_group_id) VALUES (${targetGroupId}::uuid, ${managerGroupId}::uuid)`;

      const candidates = await __notificationBatchTest.resolveCandidates({
        mode: "rules",
        rules: ["account_manager"],
        groupIds: [targetGroupId],
      });
      const candidateIds = candidates.map((candidate) => candidate.id);

      expect(candidateIds).toContain(directManagerId);
      expect(candidateIds).toContain(groupManagerId);
      expect(candidateIds).not.toContain(targetMemberId);
    } finally {
      await cleanupAuthFixture(userIds, groupIds);
    }
  });
});
