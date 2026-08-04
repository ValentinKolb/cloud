import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrateCloudAi } from "./migrate";
import { aiSkillStore } from "./skills-store";

const canUseAiDatabase = async () => {
  try {
    const [authRow] = await sql<{ users: string | null }[]>`SELECT to_regclass('auth.users')::text AS users`;
    if (!authRow?.users) return false;
    await migrateCloudAi();
    return true;
  } catch {
    return false;
  }
};

const suite = (await canUseAiDatabase()) ? describe : describe.skip;

const insertUser = async (name: string) => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-skills-${name}-${suffix}`}, 'local', 'user', ${`Skills ${name}`}, ${`ai-skills-${name}-${suffix}@example.test`}, 'AI', 'Skills')
    RETURNING id
  `;
  return row!.id;
};

suite("aiSkillStore integration", () => {
  test("shows enabled workspace skills and only the user's personal skills", async () => {
    const ownerId = await insertUser("owner");
    const otherId = await insertUser("other");
    const own = await aiSkillStore.create({
      name: `Own ${crypto.randomUUID()}`,
      description: "owner only",
      instructions: "Use the owner's format.",
      scope: "personal",
      ownerUserId: ownerId,
    });
    const workspace = await aiSkillStore.create({
      name: `Workspace ${crypto.randomUUID()}`,
      description: "shared guidance",
      instructions: "Use the workspace format.",
      scope: "workspace",
      ownerUserId: null,
    });

    try {
      const ownerView = await aiSkillStore.listVisible({ userId: ownerId });
      const otherView = await aiSkillStore.listVisible({ userId: otherId });
      expect(ownerView.some((skill) => skill.id === own.id)).toBe(true);
      expect(otherView.some((skill) => skill.id === own.id)).toBe(false);
      expect(otherView.some((skill) => skill.id === workspace.id)).toBe(true);

      await aiSkillStore.update({ skillId: workspace.id, enabled: false });
      expect(await aiSkillStore.getVisible({ skillId: workspace.id, userId: otherId })).toBeNull();
      expect((await aiSkillStore.listWorkspace()).some((skill) => skill.id === workspace.id)).toBe(true);
    } finally {
      await aiSkillStore.delete(own.id);
      await aiSkillStore.delete(workspace.id);
      await sql`DELETE FROM auth.users WHERE id IN (${ownerId}::uuid, ${otherId}::uuid)`;
    }
  });

  test("increments the revision whenever instructions change", async () => {
    const ownerId = await insertUser("revision");
    const skill = await aiSkillStore.create({
      name: `Revision ${crypto.randomUUID()}`,
      description: "versioned",
      instructions: "Version one.",
      scope: "personal",
      ownerUserId: ownerId,
    });
    try {
      const updated = await aiSkillStore.update({ skillId: skill.id, instructions: "Version two." });
      expect(updated?.revision).toBe(skill.revision + 1);
      expect(updated?.instructions).toBe("Version two.");
    } finally {
      await aiSkillStore.delete(skill.id);
      await sql`DELETE FROM auth.users WHERE id = ${ownerId}::uuid`;
    }
  });
});
