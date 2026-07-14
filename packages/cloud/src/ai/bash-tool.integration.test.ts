import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import type { User } from "../contracts/shared";
import type { RequestActor } from "../server";
import { buildAiSkillsMount, createCloudAiBashTool, createCloudAiPresentTool, listActiveAiSkillHints } from "./bash-tool";
import { aiFileStore } from "./files-store";
import { migrateCloudAi } from "./migrate";
import { aiSkillStore } from "./skills-store";
import { aiConversationStore } from "./store";

const canUseAiDatabase = async () => {
  try {
    const [authRow] = await sql<{ users: string | null }[]>`SELECT to_regclass('auth.users')::text AS users`;
    if (!authRow?.users) return false;
    await migrateCloudAi();
    const [aiRow] = await sql<{ files: string | null; skills: string | null }[]>`
      SELECT to_regclass('ai.files')::text AS files, to_regclass('ai.skills')::text AS skills
    `;
    return Boolean(aiRow?.files && aiRow.skills);
  } catch {
    return false;
  }
};

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-bash-${suffix}`}, 'local', 'user', 'Bash Test', ${`ai-bash-${suffix}@example.test`}, 'Bash', 'Test')
    RETURNING id
  `;
  return row!.id;
};

const fakeUser = (id: string): User =>
  ({
    id,
    uid: "bash-test",
    roles: ["user"],
    provider: "local",
    profile: "user",
    givenname: "Bash",
    sn: "Test",
    displayName: "Bash Test",
    mail: null,
    avatarHash: null,
    ipa: null,
    accountExpires: null,
    lastLoginLocal: null,
    memberofGroup: [],
    memberofGroupIds: [],
    manages: [],
    managesGroupIds: [],
  }) as User;

const bytes = (text: string) => new TextEncoder().encode(text);

type ServerTool = { run: (input: unknown, ctx: { actor: RequestActor; conversationId?: string }) => Promise<unknown> };

const runBash = async (input: { command: string; stdin?: string }, ctx: { actor: RequestActor; conversationId: string }) => {
  const tool = createCloudAiBashTool() as unknown as ServerTool;
  return (await tool.run(input, ctx)) as { stdout: string; stderr: string; exitCode: number };
};

describe("bash tool end-to-end", () => {
  test("reads uploads, writes workspace files, mounts active skills, presents results", async () => {
    if (!(await canUseAiDatabase())) {
      console.warn("Skipping bash tool DB test: tables are not available.");
      return;
    }
    const userId = await insertUser();
    const conversation = await aiConversationStore.createConversation({ appId: "ai-bash-test", ownerUserId: userId });
    const skill = await aiSkillStore.create({
      slug: `bash-e2e-${crypto.randomUUID().slice(0, 8)}`,
      ownerUserId: userId,
      actorUserId: userId,
    });
    const actor: RequestActor = { kind: "user", user: fakeUser(userId) };
    const ctx = { actor, conversationId: conversation.id };

    try {
      await aiSkillStore.writeFile({ skillId: skill.id, path: "/SKILL.md", bytes: bytes("# E2E skill\nUse for tests.\n"), actorUserId: userId });
      // Executable file in a user skill: mounted only after code approval — user skills never get one.
      await aiSkillStore.writeFile({ skillId: skill.id, path: "/scripts/run.js", bytes: bytes("console.log('x')\n"), actorUserId: userId });
      await aiFileStore.write({ conversationId: conversation.id, path: "/input/data.csv", bytes: bytes("a,b\n1,2\n3,4\n"), mediaType: "text/csv" });

      // Uploaded file is readable; results persist under /files across calls.
      const transform = await runBash({ command: "awk -F, 'NR>1 {sum+=$2} END {print sum}' /input/data.csv > /files/sum.txt && cat /files/sum.txt" }, ctx);
      expect(transform.exitCode).toBe(0);
      expect(transform.stdout.trim()).toBe("6");
      const persisted = await aiFileStore.readAll({ conversationId: conversation.id, path: "/files/sum.txt" });
      expect(new TextDecoder().decode(persisted!).trim()).toBe("6");

      // /input is read-only for the model.
      const readonly = await runBash({ command: "rm /input/data.csv; echo exit=$?" }, ctx);
      expect(readonly.stdout).toContain("exit=1");

      // Active skill is mounted with its markdown, without unapproved executables; README indexes it.
      const skills = await runBash({ command: `cat /skills/${skill.slug}/SKILL.md && ls /skills/${skill.slug}` }, ctx);
      expect(skills.stdout).toContain("# E2E skill");
      expect(skills.stdout).not.toContain("scripts");
      const readme = await runBash({ command: "cat /skills/README.md" }, ctx);
      expect(readme.stdout).toContain(skill.slug);

      // Consent switch removes the mount entirely.
      await aiSkillStore.setUserState({ userId, skillId: skill.id, state: "disabled" });
      const withoutSkill = await runBash({ command: `ls /skills` }, ctx);
      expect(withoutSkill.stdout).not.toContain(skill.slug);
      const hints = await listActiveAiSkillHints({ userId });
      expect(hints.some((hint) => hint.slug === skill.slug)).toBe(false);

      // present hands a produced file to the user.
      const present = createCloudAiPresentTool() as unknown as ServerTool;
      const presented = (await present.run({ path: "/files/sum.txt" }, ctx)) as { path: string; size: number; mediaType: string };
      expect(presented.path).toBe("/files/sum.txt");
      expect(presented.size).toBeGreaterThan(0);
      await expect(present.run({ path: "/files/missing.txt" }, ctx)).rejects.toThrow(/No such file/);
    } finally {
      await sql`DELETE FROM ai.skill_events WHERE skill_id = ${skill.id}::uuid`;
      await sql`DELETE FROM ai.skills WHERE id = ${skill.id}::uuid`;
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("code-approved workspace skill exposes its scripts", async () => {
    if (!(await canUseAiDatabase())) return;
    const adminId = await insertUser();
    const skill = await aiSkillStore.create({
      slug: `bash-code-${crypto.randomUUID().slice(0, 8)}`,
      ownerUserId: null,
      actorUserId: adminId,
    });

    try {
      await aiSkillStore.writeFile({ skillId: skill.id, path: "/SKILL.md", bytes: bytes("# Code skill\n"), actorUserId: adminId });
      await aiSkillStore.writeFile({ skillId: skill.id, path: "/scripts/gen.js", bytes: bytes("console.log(42)\n"), actorUserId: adminId });

      let mount = await buildAiSkillsMount({ userId: adminId });
      await expect(mount.stat(`/${skill.slug}/scripts/gen.js`)).rejects.toThrow();

      await aiSkillStore.approveCode({ skillId: skill.id, approverUserId: adminId });
      mount = await buildAiSkillsMount({ userId: adminId });
      expect((await mount.stat(`/${skill.slug}/scripts/gen.js`)).isFile).toBe(true);
    } finally {
      await sql`DELETE FROM ai.skill_events WHERE skill_id = ${skill.id}::uuid`;
      await sql`DELETE FROM ai.skills WHERE id = ${skill.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${adminId}::uuid`;
    }
  });
});
