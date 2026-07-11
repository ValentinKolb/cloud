import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrateCloudAi } from "./migrate";
import { aiConversationStore } from "./store";

const canUseAiDatabase = async () => {
  try {
    const [authRow] = await sql<{ users: string | null }[]>`
      SELECT to_regclass('auth.users')::text AS users
    `;
    if (!authRow?.users) return false;

    await migrateCloudAi();

    const [aiRow] = await sql<{ messages: string | null }[]>`
      SELECT to_regclass('ai.messages')::text AS messages
    `;
    return Boolean(aiRow?.messages);
  } catch {
    return false;
  }
};

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-page-${suffix}`}, 'local', 'user', 'AI Page Test', ${`ai-page-${suffix}@example.test`}, 'AI', 'Page')
    RETURNING id
  `;
  return row!.id;
};

const cleanupFixture = async (input: { userId: string; conversationIds: string[] }) => {
  for (const conversationId of input.conversationIds) {
    await sql`DELETE FROM ai.conversations WHERE id = ${conversationId}::uuid`;
  }
  await sql`DELETE FROM auth.users WHERE id = ${input.userId}::uuid`;
};

const insertMessage = async (input: {
  conversationId: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  compacted?: boolean;
  kind?: "message" | "summary";
}) => {
  await sql`
    INSERT INTO ai.messages (conversation_id, seq, kind, role, message, compacted_at)
    VALUES (
      ${input.conversationId},
      ${input.seq},
      ${input.kind ?? "message"},
      ${input.role},
      ${JSON.stringify({ role: input.role, content: [{ type: "text", text: input.text }] })}::jsonb,
      ${input.compacted ? new Date().toISOString() : null}
    )
  `;
};

describe.skipIf(!(await canUseAiDatabase()))("listMessagesPage (integration)", () => {
  test("windows newest-first with lossless cursor paging", async () => {
    const userId = await insertUser();
    const conversationIds: string[] = [];
    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-page-test", ownerUserId: userId });
      conversationIds.push(conversation.id);
      for (let seq = 1; seq <= 12; seq++) {
        await insertMessage({ conversationId: conversation.id, seq, role: seq % 2 ? "user" : "assistant", text: `msg ${seq}` });
      }

      // Newest window of 5: seq 8-12, more history above.
      const first = await aiConversationStore.listMessagesPage({ conversationId: conversation.id, limit: 5 });
      expect(first.messages.map((message) => message.seq)).toEqual([8, 9, 10, 11, 12]);
      expect(first.hasMore).toBe(true);

      // Page older from the window's oldest seq.
      const second = await aiConversationStore.listMessagesPage({ conversationId: conversation.id, beforeSeq: 8, limit: 5 });
      expect(second.messages.map((message) => message.seq)).toEqual([3, 4, 5, 6, 7]);
      expect(second.hasMore).toBe(true);

      const third = await aiConversationStore.listMessagesPage({ conversationId: conversation.id, beforeSeq: 3, limit: 5 });
      expect(third.messages.map((message) => message.seq)).toEqual([1, 2]);
      expect(third.hasMore).toBe(false);
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("never splits a compaction seq group and hides superseded summaries", async () => {
    const userId = await insertUser();
    const conversationIds: string[] = [];
    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-page-test", ownerUserId: userId });
      conversationIds.push(conversation.id);

      // Compacted history: archived rows on seq 1-2, the active summary shares seq 2.
      await insertMessage({ conversationId: conversation.id, seq: 1, role: "user", text: "old 1", compacted: true });
      await insertMessage({ conversationId: conversation.id, seq: 2, role: "assistant", text: "old 2", compacted: true });
      await insertMessage({ conversationId: conversation.id, seq: 2, role: "assistant", text: "summary", kind: "summary" });
      await insertMessage({ conversationId: conversation.id, seq: 3, role: "user", text: "new question" });
      await insertMessage({ conversationId: conversation.id, seq: 4, role: "assistant", text: "new answer" });

      // limit counts DISTINCT seqs — the seq-2 group (archived row + summary) stays intact.
      const window = await aiConversationStore.listMessagesPage({ conversationId: conversation.id, limit: 3 });
      expect(window.messages.map((message) => `${message.seq}:${message.kind}`)).toEqual([
        "2:message",
        "2:summary",
        "3:message",
        "4:message",
      ]);
      expect(window.hasMore).toBe(true);

      // The summary sorts after the archived row sharing its seq (same as listMessages).
      const older = await aiConversationStore.listMessagesPage({ conversationId: conversation.id, beforeSeq: 2, limit: 5 });
      expect(older.messages.map((message) => message.seq)).toEqual([1]);
      expect(older.hasMore).toBe(false);

      // Full-view parity: same visibility rules as listMessages.
      const full = await aiConversationStore.listMessages({ conversationId: conversation.id });
      const paged = await aiConversationStore.listMessagesPage({ conversationId: conversation.id, limit: 100 });
      expect(paged.messages.map((message) => message.id)).toEqual(full.map((message) => message.id));
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });
});
