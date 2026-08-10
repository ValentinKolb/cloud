import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { type AiConversation, type AiStoredMessage, aiConversationStore } from "@valentinkolb/cloud/ai";
import { compileCapabilityManifest } from "@valentinkolb/cloud/capabilities/testing";
import type { CapabilityExecutionContext, User } from "@valentinkolb/cloud/contracts";
import { assistantCapabilities } from "./capabilities";

const user: User = {
  id: "11111111-1111-4111-8111-111111111111",
  uid: "assistant-capabilities",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Assistant",
  sn: "User",
  displayName: "Assistant User",
  mail: "assistant@example.test",
  avatarHash: null,
  ipa: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
};

const context: CapabilityExecutionContext = {
  actor: { kind: "user", user },
  accessSubject: { type: "user", userId: user.id },
  user,
  signal: new AbortController().signal,
};

const chat: AiConversation = {
  id: "22222222-2222-4222-8222-222222222222",
  appId: "assistant",
  title: "Release planning",
  titleSource: "user",
  icon: "ti ti-message-chatbot",
  description: "Plan the next Cloud release.",
  descriptionSource: "auto",
  keywords: ["release", "cloud"],
  pinnedAt: null,
  archivedAt: null,
  runStatus: "idle",
  runError: null,
  unreadCompletion: false,
  projectId: null,
  resource: { kind: "direct" },
  createdByUserId: user.id,
  createdAt: "2026-08-04T12:00:00.000Z",
  updatedAt: "2026-08-04T13:00:00.000Z",
};

const storedMessage = (seq: number, message: AiStoredMessage["message"], overrides: Partial<AiStoredMessage> = {}): AiStoredMessage => ({
  id: `${seq.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
  conversationId: chat.id,
  seq,
  kind: "message",
  message,
  loopId: null,
  modelProfileId: null,
  providerModel: null,
  usage: null,
  stopReason: null,
  loopAggregate: null,
  loopDoneReason: null,
  compactedAt: null,
  meta: null,
  createdAt: `2026-08-04T12:00:0${seq}.000Z`,
  ...overrides,
});

afterEach(() => mock.restore());

describe("Assistant capabilities", () => {
  test("publishes two closed-world read queries", () => {
    const manifest = compileCapabilityManifest("assistant", assistantCapabilities);
    expect(Object.keys(assistantCapabilities.queries).sort()).toEqual(["chat.read", "chat.search"]);
    expect(manifest.queries.map((query) => query.localId).sort()).toEqual(["chat.read", "chat.search"]);
    expect(manifest.queries.every((query) => query.openWorld === false)).toBe(true);
    expect("actions" in assistantCapabilities).toBe(false);
  });

  test("searches only the current user's chats and returns an open link", async () => {
    const list = spyOn(aiConversationStore, "listConversations").mockResolvedValue([chat]);

    const result = await assistantCapabilities.queries["chat.search"].run({ query: "release", archived: false, limit: 10 }, context);

    expect(list).toHaveBeenCalledWith({
      appId: "assistant",
      ownerUserId: user.id,
      search: "release",
      archived: false,
      limit: 10,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [
          {
            ref: { type: "assistant.chat", id: chat.id },
            title: chat.title,
            links: [{ rel: "open", href: `/app/assistant?conversation=${chat.id}` }],
          },
        ],
      },
    });
  });

  test("reads bounded visible text without thinking or tool results", async () => {
    const longText = "x".repeat(8_001);
    const get = spyOn(aiConversationStore, "getConversation").mockResolvedValue(chat);
    spyOn(aiConversationStore, "listMessagesPage").mockResolvedValue({
      messages: [
        storedMessage(1, { role: "user", content: [{ type: "text", text: "Please plan it." }] }),
        storedMessage(2, {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: longText },
            { type: "tool_call", id: "call-1", name: "mail.search", args: {} },
          ],
        }),
        storedMessage(3, { role: "tool_result", callId: "call-1", name: "mail.search", result: { secret: true } }),
      ],
      hasMore: true,
    });

    const result = await assistantCapabilities.queries["chat.read"].run({ chatId: chat.id, limit: 20 }, context);

    expect(get).toHaveBeenCalledWith({ conversationId: chat.id, appId: "assistant", ownerUserId: user.id });
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: {
          chat: { id: chat.id, title: chat.title },
          messages: [
            { seq: 1, role: "user", text: "Please plan it.", truncated: false },
            { seq: 2, role: "assistant", truncated: true },
          ],
        },
        refs: [{ type: "assistant.chat", id: chat.id }],
        links: [{ rel: "open", href: `/app/assistant?conversation=${chat.id}` }],
        page: { hasMore: true, nextCursor: "1" },
      },
    });
    if (result.ok) {
      expect(result.data.data.messages[1]?.text).toHaveLength(8_000);
      expect(JSON.stringify(result)).not.toContain("private reasoning");
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  test("does not reveal missing or other users' chats", async () => {
    spyOn(aiConversationStore, "getConversation").mockResolvedValue(null);

    const result = await assistantCapabilities.queries["chat.read"].run({ chatId: chat.id, limit: 20 }, context);

    expect(result).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Chat not found", status: 404 } });
  });

  test("rejects actors without a delegated user", async () => {
    const list = spyOn(aiConversationStore, "listConversations");
    const result = await assistantCapabilities.queries["chat.search"].run(
      { query: "", archived: false, limit: 10 },
      { ...context, user: null },
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Assistant chats require a user-backed actor", status: 403 },
    });
    expect(list).not.toHaveBeenCalled();
  });
});
