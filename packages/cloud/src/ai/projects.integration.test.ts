import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrateCloudAi } from "./migrate";
import { aiProjects } from "./projects";
import { aiConversationStore } from "./store";

const canUseAiDatabase = async () => {
  try {
    const [row] = await sql<{ users: string | null; access: string | null }[]>`
      SELECT to_regclass('auth.users')::text AS users, to_regclass('auth.access')::text AS access
    `;
    if (!row?.users || !row.access) return false;
    await migrateCloudAi();
    return true;
  } catch {
    return false;
  }
};

const insertUser = async (label: string) => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-project-${label}-${suffix}`}, 'local', 'user', ${`Project ${label}`}, ${`ai-project-${suffix}@example.test`}, 'AI', 'Project')
    RETURNING id
  `;
  return row!.id;
};

describe.skipIf(!(await canUseAiDatabase()))("aiProjects (integration)", () => {
  test("shares through authoritative group access and snapshots Project context", async () => {
    const ownerId = await insertUser("owner");
    const memberId = await insertUser("member");
    const owner = { type: "user" as const, userId: ownerId };
    const member = { type: "user" as const, userId: memberId };
    const suffix = crypto.randomUUID();
    const [group] = await sql<{ id: string }[]>`
      INSERT INTO auth.groups (cn, provider, name, description)
      VALUES (${`ai-project-${suffix}`}, 'local', ${`AI Project ${suffix}`}, 'Project integration test')
      RETURNING id
    `;

    try {
      await sql`INSERT INTO auth.user_groups_v2 (user_id, group_id) VALUES (${memberId}::uuid, ${group!.id}::uuid)`;
      const project = await aiProjects.create({
        subject: owner,
        name: "Support",
        instructions: "Answer with the support policy.",
        defaultModelProfileId: "model-support",
      });
      const grant = await aiProjects.grantAccess(project.id, owner, {
        principal: { type: "group", groupId: group!.id },
        permission: "write",
      });
      expect(grant?.permission).toBe("write");

      const visible = await aiProjects.get(project.id, member, "write");
      expect(visible?.permission).toBe("write");
      const knowledge = await aiProjects.createKnowledge(project.id, member, {
        title: "Escalation",
        content: "Escalate account lockouts to identity operations.",
      });
      const file = await aiProjects.writeFile(project.id, member, {
        path: "guides/triage.md",
        mediaType: "text/markdown",
        bytes: new TextEncoder().encode("# Triage"),
      });
      const reference = await aiProjects.createReference(project.id, member, {
        ref: { type: "notebooks.notebook", id: "support-runbook" },
        label: "Runbook",
      });
      expect(knowledge).not.toBeNull();
      expect(file).not.toBeNull();
      expect(reference).not.toBeNull();

      const snapshot = await aiProjects.snapshot(project.id, member);
      expect(snapshot?.instructions).toBe("Answer with the support policy.");
      expect(snapshot?.defaultModelProfileId).toBe("model-support");
      expect(snapshot?.context).toContain("Escalation");
      expect(snapshot?.context).toContain("guides/triage.md");
      expect(snapshot?.context).toContain("notebooks.notebook/support-runbook");

      const ownerChat = await aiConversationStore.createConversation({ appId: "assistant", ownerUserId: ownerId, projectId: project.id });
      const memberChat = await aiConversationStore.createConversation({ appId: "assistant", ownerUserId: memberId, projectId: project.id });
      expect((await aiConversationStore.listConversations({ appId: "assistant", ownerUserId: ownerId })).map((chat) => chat.id)).toEqual([
        ownerChat.id,
      ]);
      expect((await aiConversationStore.listConversations({ appId: "assistant", ownerUserId: memberId })).map((chat) => chat.id)).toEqual([
        memberChat.id,
      ]);
      expect(ownerChat.projectId).toBe(project.id);
      expect(memberChat.projectId).toBe(project.id);

      expect(await aiProjects.revokeAccess(project.id, grant!.id, owner)).toBe(true);
      expect(await aiProjects.get(project.id, member)).toBeNull();
    } finally {
      await sql`DELETE FROM ai.conversations WHERE created_by_user_id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await sql`DELETE FROM auth.users WHERE id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await sql`DELETE FROM auth.groups WHERE id = ${group!.id}::uuid`;
    }
  });
});
