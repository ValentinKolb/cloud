import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { aiFileStore, normalizeAiFilePath } from "./files-store";
import { migrateCloudAi } from "./migrate";
import { aiConversationStore } from "./store";

const canUseAiDatabase = async () => {
  try {
    const [authRow] = await sql<{ users: string | null }[]>`SELECT to_regclass('auth.users')::text AS users`;
    if (!authRow?.users) return false;
    await migrateCloudAi();
    const [aiRow] = await sql<{ files: string | null }[]>`SELECT to_regclass('ai.files')::text AS files`;
    return Boolean(aiRow?.files);
  } catch {
    return false;
  }
};

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-files-${suffix}`}, 'local', 'user', 'AI Files Test', ${`ai-files-${suffix}@example.test`}, 'AI', 'Files')
    RETURNING id
  `;
  return row!.id;
};

const bytes = (text: string) => new TextEncoder().encode(text);

describe("normalizeAiFilePath", () => {
  test("accepts absolute clean paths and rejects traversal", () => {
    expect(normalizeAiFilePath("/files/a.txt")).toBe("/files/a.txt");
    expect(normalizeAiFilePath("/files//b/./c.txt")).toBe("/files/b/c.txt");
    expect(normalizeAiFilePath("relative.txt")).toBeNull();
    expect(normalizeAiFilePath("/files/../etc/passwd")).toBeNull();
    expect(normalizeAiFilePath("/")).toBeNull();
  });
});

describe("aiFileStore integration", () => {
  test("write, stat, slice reads, rename, remove, totals", async () => {
    if (!(await canUseAiDatabase())) {
      console.warn("Skipping AI files DB test: tables are not available.");
      return;
    }
    const userId = await insertUser();
    const conversation = await aiConversationStore.createConversation({ appId: "ai-files-test", ownerUserId: userId });

    try {
      await aiFileStore.write({ conversationId: conversation.id, path: "/input/data.csv", bytes: bytes("a,b\n1,2\n3,4\n"), mediaType: "text/csv" });
      const stat = await aiFileStore.stat({ conversationId: conversation.id, path: "/input/data.csv" });
      expect(stat?.size).toBe(12);
      expect(stat?.mediaType).toBe("text/csv");

      // Partial read: bytes 4..9 without loading the whole value.
      const slice = await aiFileStore.readSlice({ conversationId: conversation.id, path: "/input/data.csv", offset: 4, length: 4 });
      expect(new TextDecoder().decode(slice!)).toBe("1,2\n");

      await aiFileStore.append({ conversationId: conversation.id, path: "/input/data.csv", bytes: bytes("5,6\n") });
      const all = await aiFileStore.readAll({ conversationId: conversation.id, path: "/input/data.csv" });
      expect(new TextDecoder().decode(all!)).toEndWith("5,6\n");

      await aiFileStore.write({ conversationId: conversation.id, path: "/files/out/report.md", bytes: bytes("# Report\n") });
      const listed = await aiFileStore.list({ conversationId: conversation.id, prefix: "/files" });
      expect(listed.map((entry) => entry.path)).toEqual(["/files/out/report.md"]);

      expect(await aiFileStore.totalBytes(conversation.id)).toBe(16 + 9);

      const renamed = await aiFileStore.rename({ conversationId: conversation.id, from: "/files/out/report.md", to: "/files/report.md" });
      expect(renamed).toBe(true);

      const removed = await aiFileStore.remove({ conversationId: conversation.id, path: "/input", recursive: true });
      expect(removed).toBe(1);
      expect(await aiFileStore.stat({ conversationId: conversation.id, path: "/input/data.csv" })).toBeNull();
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("enforces per-file and per-conversation limits in the store", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversation = await aiConversationStore.createConversation({ appId: "ai-files-test", ownerUserId: userId });

    try {
      await expect(
        aiFileStore.write({ conversationId: conversation.id, path: "/files/big.bin", bytes: bytes("xxxxxxxxxx"), maxFileBytes: 5 }),
      ).rejects.toThrow(/per-file limit/);

      await aiFileStore.write({ conversationId: conversation.id, path: "/files/a.bin", bytes: bytes("12345"), maxConversationBytes: 8 });
      await expect(
        aiFileStore.write({ conversationId: conversation.id, path: "/files/b.bin", bytes: bytes("12345"), maxConversationBytes: 8 }),
      ).rejects.toThrow(/storage limit/);
      // Overwriting the same path counts the replaced size, not double.
      await aiFileStore.write({ conversationId: conversation.id, path: "/files/a.bin", bytes: bytes("1234567"), maxConversationBytes: 8 });
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("copyToConversation carries the VFS into a fork", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const source = await aiConversationStore.createConversation({ appId: "ai-files-test", ownerUserId: userId });
    const target = await aiConversationStore.createConversation({ appId: "ai-files-test", ownerUserId: userId });

    try {
      await aiFileStore.write({ conversationId: source.id, path: "/input/a.txt", bytes: bytes("hello") });
      await aiFileStore.write({ conversationId: source.id, path: "/files/b.txt", bytes: bytes("world") });
      const copied = await aiFileStore.copyToConversation({ sourceConversationId: source.id, targetConversationId: target.id });
      expect(copied).toBe(2);
      const all = await aiFileStore.readAll({ conversationId: target.id, path: "/files/b.txt" });
      expect(new TextDecoder().decode(all!)).toBe("world");
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id = ${source.id}::uuid`;
      await sql`DELETE FROM ai.conversations WHERE id = ${target.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
