import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrateCloudAi } from "./migrate";
import { aiUserPrefs } from "./prefs";

const canUseAiDatabase = async () => {
  try {
    const [authRow] = await sql<{ users: string | null }[]>`
      SELECT to_regclass('auth.users')::text AS users
    `;
    if (!authRow?.users) return false;

    await migrateCloudAi();

    const [aiRow] = await sql<{ prefs: string | null }[]>`
      SELECT to_regclass('ai.user_prefs')::text AS prefs
    `;
    return Boolean(aiRow?.prefs);
  } catch {
    return false;
  }
};

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-prefs-${suffix}`}, 'local', 'user', 'AI Prefs Test', ${`ai-prefs-${suffix}@example.test`}, 'AI', 'Prefs')
    RETURNING id
  `;
  return row!.id;
};

// user delete cascades ai.user_prefs
const cleanupUser = async (userId: string) => {
  await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
};

describe.skipIf(!(await canUseAiDatabase()))("aiUserPrefs (integration)", () => {
  test("get returns defaults for users without a row", async () => {
    const userId = await insertUser();
    try {
      const prefs = await aiUserPrefs.get(userId);
      expect(prefs.memoryEnabled).toBe(true);
      expect(prefs.memoryLearningEnabled).toBe(false);
    } finally {
      await cleanupUser(userId);
    }
  });

  test("update upserts partial patches", async () => {
    const userId = await insertUser();
    try {
      const first = await aiUserPrefs.update(userId, { memoryEnabled: true });
      expect(first.memoryEnabled).toBe(true);

      const second = await aiUserPrefs.update(userId, { memoryEnabled: false });
      expect(second.memoryEnabled).toBe(false);
      const third = await aiUserPrefs.update(userId, { memoryLearningEnabled: true });
      expect(third.memoryEnabled).toBe(false);
      expect(third.memoryLearningEnabled).toBe(true);
    } finally {
      await cleanupUser(userId);
    }
  });
});
