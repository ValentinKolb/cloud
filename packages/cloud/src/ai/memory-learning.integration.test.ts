import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { aiMemories } from "./memories";
import { learnAiMemoriesFromPrivateChats } from "./memory-learning";
import { migrateCloudAi } from "./migrate";
import { createAiShortId } from "./short-id";
import type { AiResolvedModel } from "./types";

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

describe.skipIf(!(await canUseAiDatabase()))("AI memory learning (integration)", () => {
  test("stores bounded learned memories with conversation provenance", async () => {
    const suffix = crypto.randomUUID();
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
      VALUES (${`ai-learning-${suffix}`}, 'local', 'user', 'AI Learning Test', ${`ai-learning-${suffix}@example.test`}, 'AI', 'Learning')
      RETURNING id
    `;
    const [conversation] = await sql<{ id: string; dirty_as_of: string }[]>`
      INSERT INTO ai.conversations (short_id, created_by_user_id, title)
      VALUES (${createAiShortId()}, ${user!.id}::uuid, 'Memory learning test')
      RETURNING id, updated_at::text AS dirty_as_of
    `;
    await sql`
      INSERT INTO ai.messages (short_id, conversation_id, seq, role, message)
      VALUES (
        ${createAiShortId()},
        ${conversation!.id}::uuid,
        1,
        'user',
        ${JSON.stringify({ role: "user", content: [{ type: "text", text: "I prefer concise answers in German." }] })}::jsonb
      )
    `;

    try {
      const summary = await learnAiMemoriesFromPrivateChats({
        deps: {
          resolveModel: async () => ({ profile: { id: "test-model" } }) as AiResolvedModel,
          listCandidates: async () => [
            {
              conversationId: conversation!.id,
              userId: user!.id,
              dirtyAsOf: conversation!.dirty_as_of,
              failCount: 0,
            },
          ],
          structured: async () =>
            ({
              output: { memories: [{ kind: "preference", content: "Prefers concise answers in German.", replacesId: "" }] },
              modelProfileId: "test-model",
              structuredMeta: { mode: "native" },
            }) as never,
        },
      });

      expect(summary).toEqual({ scanned: 1, learned: 1, updated: 0, skipped: 0, failed: 0 });
      const [memory] = await aiMemories.list({ userId: user!.id });
      expect(memory?.content).toBe("Prefers concise answers in German.");
      expect(memory?.source).toBe("background");
      expect(memory?.sourceConversationId).toBe(conversation!.id);
    } finally {
      await sql`DELETE FROM auth.users WHERE id = ${user!.id}::uuid`;
    }
  });
});
