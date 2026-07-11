import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { seedBuiltinAiSkills } from "./builtin-skills";
import { migrateCloudAi } from "./migrate";
import { aiSkillStore, computeAiSkillContentHash } from "./skills-store";

const canUseAiDatabase = async () => {
  try {
    const [authRow] = await sql<{ users: string | null }[]>`SELECT to_regclass('auth.users')::text AS users`;
    if (!authRow?.users) return false;
    await migrateCloudAi();
    const [aiRow] = await sql<{ skills: string | null }[]>`SELECT to_regclass('ai.skills')::text AS skills`;
    return Boolean(aiRow?.skills);
  } catch {
    return false;
  }
};

const insertUser = async (name: string) => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-skills-${name}-${suffix}`}, 'local', 'user', ${`Skills ${name}`}, ${`ai-skills-${name}-${suffix}@example.test`}, 'AI', 'Skills')
    RETURNING id
  `;
  return row!.id;
};

const bytes = (text: string) => new TextEncoder().encode(text);
const uniqueSlug = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

const deleteSkill = async (skillId: string) => {
  await sql`DELETE FROM ai.skill_events WHERE skill_id = ${skillId}::uuid`;
  await sql`DELETE FROM ai.skills WHERE id = ${skillId}::uuid`;
};

describe("builtin skill seeding", () => {
  test("seeds calc as a workspace skill once; admin deletion sticks", async () => {
    if (!(await canUseAiDatabase())) {
      console.warn("Skipping builtin seeding DB test: tables are not available.");
      return;
    }
    // Migration already seeded — calc exists as an ordinary workspace skill
    // with its SKILL.md, unless an admin deleted it (then the marker remains).
    const [marker] = await sql<{ id: string }[]>`
      SELECT id FROM ai.skill_events
      WHERE skill_slug = 'calc' AND event = 'created' AND meta->>'seeded' = 'true'
      LIMIT 1
    `;
    expect(marker).toBeTruthy();

    const calc = await aiSkillStore.getBySlug("calc");
    if (calc) {
      expect(calc.ownerUserId).toBeNull();
      const skillMd = await aiSkillStore.readFile(calc.id, "/SKILL.md");
      expect(new TextDecoder().decode(skillMd!.bytes)).toContain("calc math");

      // Re-seeding is a no-op while the skill exists…
      await seedBuiltinAiSkills();
      expect((await aiSkillStore.listAll({ q: "calc" })).skills.filter((entry) => entry.slug === "calc")).toHaveLength(1);

      // …and after deletion the seed marker keeps it gone.
      await aiSkillStore.delete({ skillId: calc.id, actorUserId: null });
      await seedBuiltinAiSkills();
      expect(await aiSkillStore.getBySlug("calc")).toBeNull();

      // Restore for other tests/dev use: reseed by clearing the marker.
      await sql`UPDATE ai.skill_events SET meta = meta - 'seeded' WHERE skill_slug = 'calc' AND event = 'created'`;
      await seedBuiltinAiSkills();
      expect(await aiSkillStore.getBySlug("calc")).toBeTruthy();
    }
  });
});

describe("aiSkillStore integration", () => {
  test("code approval binds to the content hash and revokes on change", async () => {
    if (!(await canUseAiDatabase())) {
      console.warn("Skipping AI skills DB test: tables are not available.");
      return;
    }
    const adminId = await insertUser("admin");
    const skill = await aiSkillStore.create({ slug: uniqueSlug("wsp"), ownerUserId: null, actorUserId: adminId });

    try {
      await aiSkillStore.writeFile({ skillId: skill.id, path: "/SKILL.md", bytes: bytes("# Skill\n"), actorUserId: adminId });
      await aiSkillStore.writeFile({ skillId: skill.id, path: "/scripts/run.js", bytes: bytes("console.log(1)\n"), actorUserId: adminId });

      const hashBefore = await computeAiSkillContentHash(skill.id);
      await aiSkillStore.requestCodeReview({ skillId: skill.id, actorUserId: adminId });
      const approved = await aiSkillStore.approveCode({ skillId: skill.id, approverUserId: adminId });
      expect(approved?.allowCode).toBe(true);
      expect(approved?.codeApprovedHash).toBe(hashBefore);

      // Any content change makes the approval stale: allow_code is revoked.
      await aiSkillStore.writeFile({ skillId: skill.id, path: "/scripts/run.js", bytes: bytes("console.log(2)\n"), actorUserId: adminId });
      const afterChange = await aiSkillStore.get(skill.id);
      expect(afterChange?.allowCode).toBe(false);
      expect(await computeAiSkillContentHash(skill.id)).not.toBe(hashBefore);

      const { events } = await aiSkillStore.listEvents({ skillId: skill.id });
      const kinds = events.map((event) => event.event);

      // Keyset pagination: a 2-event page yields a cursor whose next page
      // starts strictly after it and never repeats entries.
      const firstPage = await aiSkillStore.listEvents({ skillId: skill.id, limit: 2 });
      expect(firstPage.events).toHaveLength(2);
      expect(firstPage.nextCursor).toBeTruthy();
      const secondPage = await aiSkillStore.listEvents({ skillId: skill.id, limit: 50, before: firstPage.nextCursor! });
      const firstIds = new Set(firstPage.events.map((event) => event.id));
      expect(secondPage.events.every((event) => !firstIds.has(event.id))).toBe(true);
      expect(firstPage.events.length + secondPage.events.length).toBe(events.length);
      expect(kinds).toContain("code_review_requested");
      expect(kinds).toContain("code_approved");
      expect(kinds).toContain("code_revoked");
    } finally {
      await deleteSkill(skill.id);
      await sql`DELETE FROM auth.users WHERE id = ${adminId}::uuid`;
    }
  });

  test("visibility: own + workspace are default-enabled, foreign shares are consent-gated offers", async () => {
    if (!(await canUseAiDatabase())) return;
    const ownerId = await insertUser("owner");
    const otherId = await insertUser("other");
    const ownSkill = await aiSkillStore.create({ slug: uniqueSlug("own"), ownerUserId: ownerId, actorUserId: ownerId });
    const workspaceSkill = await aiSkillStore.create({ slug: uniqueSlug("ws"), ownerUserId: null, actorUserId: ownerId });

    try {
      // The other user sees the workspace skill but NOT the private skill.
      let otherView = await aiSkillStore.visibleSkills({ userId: otherId, userGroups: [] });
      expect(otherView.some((entry) => entry.id === workspaceSkill.id)).toBe(true);
      expect(otherView.some((entry) => entry.id === ownSkill.id)).toBe(false);

      // Sharing turns it into an offer: visible, origin=shared, default disabled.
      await aiSkillStore.grantAccess({
        skillId: ownSkill.id,
        principal: { type: "user", userId: otherId },
        permission: "read",
        actorUserId: ownerId,
      });
      otherView = await aiSkillStore.visibleSkills({ userId: otherId, userGroups: [] });
      const shared = otherView.find((entry) => entry.id === ownSkill.id);
      expect(shared?.origin).toBe("shared");
      expect(shared?.userState).toBe("disabled");

      // Not active until the user consents.
      let active = await aiSkillStore.activeSkills({ userId: otherId, userGroups: [] });
      expect(active.some((entry) => entry.id === ownSkill.id)).toBe(false);
      await aiSkillStore.setUserState({ userId: otherId, skillId: ownSkill.id, state: "enabled" });
      active = await aiSkillStore.activeSkills({ userId: otherId, userGroups: [] });
      expect(active.some((entry) => entry.id === ownSkill.id)).toBe(true);

      // The owner sees their skill as own + enabled by default.
      const ownerView = await aiSkillStore.visibleSkills({ userId: ownerId, userGroups: [] });
      const own = ownerView.find((entry) => entry.id === ownSkill.id);
      expect(own?.origin).toBe("own");
      expect(own?.userState).toBe("enabled");
    } finally {
      await deleteSkill(ownSkill.id);
      await deleteSkill(workspaceSkill.id);
      await sql`DELETE FROM auth.users WHERE id = ${ownerId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${otherId}::uuid`;
    }
  });

  test("disabled skills leave every catalog; revoked shares disappear", async () => {
    if (!(await canUseAiDatabase())) return;
    const ownerId = await insertUser("owner2");
    const otherId = await insertUser("other2");
    const skill = await aiSkillStore.create({ slug: uniqueSlug("gone"), ownerUserId: ownerId, actorUserId: ownerId });

    try {
      const entry = await aiSkillStore.grantAccess({
        skillId: skill.id,
        principal: { type: "user", userId: otherId },
        permission: "read",
        actorUserId: ownerId,
      });
      await aiSkillStore.setUserState({ userId: otherId, skillId: skill.id, state: "enabled" });

      await aiSkillStore.update({ skillId: skill.id, enabled: false, actorUserId: ownerId });
      const active = await aiSkillStore.activeSkills({ userId: otherId, userGroups: [] });
      expect(active.some((candidate) => candidate.id === skill.id)).toBe(false);

      await aiSkillStore.update({ skillId: skill.id, enabled: true, actorUserId: ownerId });
      await aiSkillStore.revokeAccess({ skillId: skill.id, accessId: entry!.id, actorUserId: ownerId });
      const visible = await aiSkillStore.visibleSkills({ userId: otherId, userGroups: [] });
      expect(visible.some((candidate) => candidate.id === skill.id)).toBe(false);
    } finally {
      await deleteSkill(skill.id);
      await sql`DELETE FROM auth.users WHERE id = ${ownerId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${otherId}::uuid`;
    }
  });
});
