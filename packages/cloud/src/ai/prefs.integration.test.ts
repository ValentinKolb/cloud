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
      expect(prefs.instructions).toBe("");
      expect(prefs.memory).toBe("");
      expect(prefs.memoryEnabled).toBe(true);
    } finally {
      await cleanupUser(userId);
    }
  });

  test("update upserts partial patches", async () => {
    const userId = await insertUser();
    try {
      const first = await aiUserPrefs.update(userId, { instructions: "Answer in German." });
      expect(first.instructions).toBe("Answer in German.");
      expect(first.memoryEnabled).toBe(true);

      const second = await aiUserPrefs.update(userId, { memoryEnabled: false });
      expect(second.instructions).toBe("Answer in German.");
      expect(second.memoryEnabled).toBe(false);
    } finally {
      await cleanupUser(userId);
    }
  });

  test("addMemory appends date-stamped lines and removeMemory deletes matches", async () => {
    const userId = await insertUser();
    const now = new Date("2026-07-09T12:00:00Z");
    try {
      expect(await aiUserPrefs.addMemory(userId, "Studies computer science.", now)).toBe("[2026-07-09] Studies computer science.");
      expect(await aiUserPrefs.addMemory(userId, "  Prefers   German answers. ", now)).toBe("[2026-07-09] Prefers German answers.");
      // A model echoing an existing stamp must not double-prefix.
      expect(await aiUserPrefs.addMemory(userId, "[2025-01-01] Works at the library.", now)).toBe("[2026-07-09] Works at the library.");
      expect(await aiUserPrefs.addMemory(userId, "   ", now)).toBeNull();

      const prefs = await aiUserPrefs.get(userId);
      expect(prefs.memory).toBe(
        "[2026-07-09] Studies computer science.\n[2026-07-09] Prefers German answers.\n[2026-07-09] Works at the library.",
      );

      // Matching ignores the date prefix on both sides.
      const removed = await aiUserPrefs.removeMemory(userId, "[2026-07-09] german");
      expect(removed).toEqual(["[2026-07-09] Prefers German answers."]);
      expect((await aiUserPrefs.get(userId)).memory).toBe("[2026-07-09] Studies computer science.\n[2026-07-09] Works at the library.");

      expect(await aiUserPrefs.removeMemory(userId, "does-not-exist")).toEqual([]);
    } finally {
      await cleanupUser(userId);
    }
  });
});
