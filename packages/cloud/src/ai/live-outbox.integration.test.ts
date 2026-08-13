import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { aiFileStore } from "./files-store";
import { migrateCloudAi } from "./migrate";
import { aiProjects } from "./projects";
import { aiConversations } from "./store";

const databaseAvailable = async () => {
  try {
    const [row] = await sql<{ users: string | null }[]>`SELECT to_regclass('auth.users')::text AS users`;
    if (!row?.users) return false;
    await migrateCloudAi();
    return true;
  } catch {
    return false;
  }
};

const suite = (await databaseAvailable()) ? describe : describe.skip;

const insertUser = async (label: string): Promise<string> => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-live-${label}-${suffix}`}, 'local', 'user', ${`AI Live ${label}`}, ${`ai-live-${suffix}@example.test`}, 'AI', 'Live')
    RETURNING id
  `;
  return row!.id;
};

const insertServiceAccount = async (label: string): Promise<string> => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.service_accounts (name, kind, app_id, resource_type, resource_id)
    VALUES (${`AI Live ${label} ${suffix}`}, 'resource_bound', 'ai-live-test', 'project-test', ${suffix})
    RETURNING id
  `;
  return row!.id;
};

suite("AI live invalidation outbox", () => {
  test("commits conversation invalidations atomically with the domain write", async () => {
    const userId = await insertUser("owner");
    const conversation = await aiConversations.createConversation({ appId: "assistant", ownerUserId: userId });
    try {
      const created = await sql<{ domains: string[]; conversation_short_id: string }[]>`
        SELECT domains, conversation_short_id
        FROM ai.live_invalidation_outbox
        WHERE audience_user_id = ${userId}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(created[0]?.conversation_short_id).toBe(conversation.shortId);
      expect(created[0]?.domains.sort()).toEqual(["conversation-detail", "conversation-list"]);

      await aiFileStore.write({
        conversationId: conversation.id,
        path: "/photo.png",
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "image/png",
        origin: "user",
      });
      const [fileInvalidation] = await sql<{ domains: string[] }[]>`
        SELECT domains FROM ai.live_invalidation_outbox
        WHERE audience_user_id = ${userId}::uuid AND conversation_short_id = ${conversation.shortId}
        ORDER BY created_at DESC LIMIT 1
      `;
      expect(fileInvalidation?.domains).toContain("conversation-files");

      const before = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM ai.live_invalidation_outbox WHERE audience_user_id = ${userId}::uuid
      `;
      await expect(
        sql.begin(async (tx) => {
          await tx`UPDATE ai.conversations SET title = 'rolled back' WHERE id = ${conversation.id}::uuid`;
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      const after = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM ai.live_invalidation_outbox WHERE audience_user_id = ${userId}::uuid
      `;
      expect(after[0]?.count).toBe(before[0]?.count);
      expect((await aiConversations.getConversation({ conversationId: conversation.id }))?.title).toBe("New chat");
    } finally {
      await sql`DELETE FROM ai.live_invalidation_outbox WHERE audience_user_id = ${userId}::uuid`;
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("routes shared Project changes to members without sharing their chats", async () => {
    const ownerId = await insertUser("owner");
    const memberId = await insertUser("member");
    const owner = { type: "user" as const, userId: ownerId };
    const project = await aiProjects.create({ appId: "ai-live-test", subject: owner, name: "Realtime Project" });
    let chatId: string | null = null;
    try {
      await sql`DELETE FROM ai.live_invalidation_outbox WHERE audience_user_id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      const memberGrant = await aiProjects.grantAccess(project.id, "ai-live-test", owner, {
        principal: { type: "user", userId: memberId },
        permission: "read",
      });

      const recipients = await sql<{ audience_user_id: string }[]>`
        SELECT DISTINCT audience_user_id::text
        FROM ai.live_invalidation_outbox
        WHERE project_short_id = ${project.shortId}
        ORDER BY audience_user_id::text
      `;
      expect(recipients.map((row) => row.audience_user_id).sort()).toEqual([memberId, ownerId].sort());
      const projectApps = await sql<{ app_id: string }[]>`
        SELECT DISTINCT app_id FROM ai.live_invalidation_outbox WHERE project_short_id = ${project.shortId}
      `;
      expect(projectApps.map((row) => row.app_id)).toEqual(["ai-live-test"]);

      await sql`DELETE FROM ai.live_invalidation_outbox WHERE audience_user_id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await aiProjects.updateAccess(project.id, "ai-live-test", memberGrant!.id, owner, "write");
      const permissionRecipients = await sql<{ audience_user_id: string }[]>`
        SELECT DISTINCT audience_user_id::text FROM ai.live_invalidation_outbox
        WHERE project_short_id = ${project.shortId} ORDER BY audience_user_id::text
      `;
      expect(permissionRecipients.map((row) => row.audience_user_id).sort()).toEqual([memberId, ownerId].sort());

      await sql`DELETE FROM ai.live_invalidation_outbox WHERE audience_user_id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await aiProjects.revokeAccess(project.id, "ai-live-test", memberGrant!.id, owner);
      const revokeRecipients = await sql<{ audience_user_id: string }[]>`
        SELECT DISTINCT audience_user_id::text FROM ai.live_invalidation_outbox
        WHERE project_short_id = ${project.shortId} ORDER BY audience_user_id::text
      `;
      expect(revokeRecipients.map((row) => row.audience_user_id).sort()).toEqual([memberId, ownerId].sort());

      const chat = await aiConversations.createConversation({
        appId: "ai-live-test",
        ownerUserId: ownerId,
        projectId: project.id,
      });
      chatId = chat.id;
      const chatRecipients = await sql<{ audience_user_id: string }[]>`
        SELECT DISTINCT audience_user_id::text
        FROM ai.live_invalidation_outbox
        WHERE conversation_short_id = ${chat.shortId}
      `;
      expect(chatRecipients.map((row) => row.audience_user_id)).toEqual([ownerId]);
    } finally {
      if (chatId) await sql`DELETE FROM ai.conversations WHERE id = ${chatId}::uuid`;
      await sql`DELETE FROM ai.projects WHERE id = ${project.id}::uuid`;
      await sql`DELETE FROM ai.live_invalidation_outbox WHERE audience_user_id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await sql`DELETE FROM auth.users WHERE id IN (${ownerId}::uuid, ${memberId}::uuid)`;
    }
  });

  test("tracks nested membership changes and skips service-account-only browser delivery", async () => {
    const ownerId = await insertUser("group-owner");
    const memberId = await insertUser("nested-member");
    const serviceAccountId = await insertServiceAccount("only");
    const owner = { type: "user" as const, userId: ownerId };
    const service = { type: "service_account" as const, serviceAccountId };
    const suffix = crypto.randomUUID();
    const groups = await sql<{ id: string }[]>`
      INSERT INTO auth.groups (cn, provider, name, description)
      VALUES
        (${`ai-live-parent-${suffix}`}, 'local', 'Live parent', 'Live parent'),
        (${`ai-live-child-${suffix}`}, 'local', 'Live child', 'Live child')
      RETURNING id
    `;
    const project = await aiProjects.create({ appId: "ai-live-test", subject: owner, name: "Group Project" });
    const serviceProject = await aiProjects.create({ appId: "ai-live-test", subject: service, name: "Service Project" });
    try {
      await aiProjects.grantAccess(project.id, "ai-live-test", owner, {
        principal: { type: "group", groupId: groups[0]!.id },
        permission: "read",
      });
      await sql`INSERT INTO auth.group_groups_v2 (parent_group_id, child_group_id) VALUES (${groups[0]!.id}::uuid, ${groups[1]!.id}::uuid)`;
      await sql`DELETE FROM ai.live_invalidation_outbox WHERE audience_user_id IN (${ownerId}::uuid, ${memberId}::uuid)`;

      await sql`INSERT INTO auth.user_groups_v2 (user_id, group_id) VALUES (${memberId}::uuid, ${groups[1]!.id}::uuid)`;
      expect(
        (
          await sql<{ audience_user_id: string }[]>`
            SELECT DISTINCT audience_user_id::text FROM ai.live_invalidation_outbox
            WHERE project_short_id = ${project.shortId}
          `
        ).map((row) => row.audience_user_id),
      ).toContain(memberId);

      await sql`DELETE FROM ai.live_invalidation_outbox WHERE audience_user_id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await sql`DELETE FROM auth.user_groups_v2 WHERE user_id = ${memberId}::uuid AND group_id = ${groups[1]!.id}::uuid`;
      expect(
        (
          await sql<{ audience_user_id: string }[]>`
            SELECT DISTINCT audience_user_id::text FROM ai.live_invalidation_outbox
            WHERE project_short_id = ${project.shortId}
          `
        ).map((row) => row.audience_user_id),
      ).toContain(memberId);

      expect(
        (
          await sql<{ count: number }[]>`
            SELECT count(*)::int AS count FROM ai.live_invalidation_outbox
            WHERE project_short_id = ${serviceProject.shortId}
          `
        )[0]?.count,
      ).toBe(0);
    } finally {
      await aiProjects.delete(project.id, "ai-live-test", owner);
      await aiProjects.delete(serviceProject.id, "ai-live-test", service);
      await sql`DELETE FROM ai.live_invalidation_outbox WHERE audience_user_id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await sql`DELETE FROM auth.users WHERE id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await sql`DELETE FROM auth.service_accounts WHERE id = ${serviceAccountId}::uuid`;
      await sql`DELETE FROM auth.groups WHERE id IN (${groups[0]!.id}::uuid, ${groups[1]!.id}::uuid)`;
    }
  });
});
