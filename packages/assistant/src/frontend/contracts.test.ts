import { describe, expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("Assistant frontend contracts", () => {
  test("uses the typed JSON client and user-backed route guards", async () => {
    const [client, apiRoutes, pageRoutes] = await Promise.all([read("../api/client.ts"), read("../api/index.ts"), read("./index.ts")]);

    expect(client).toContain("api.create<ApiType>");
    expect(client).not.toContain("fetch(");
    expect(apiRoutes).toContain("auth.requireUser()");
    expect(pageRoutes).toContain("auth.requireUser(auth.redirectToLogin)");
  });

  test("keeps one hydration boundary and viewport-safe dialogs", async () => {
    const [allChats, allChatsList, conversationEditor, preferences, artifacts] = await Promise.all([
      read("./AssistantAllChatsDialog.tsx"),
      read("./AssistantAllChatsList.tsx"),
      read("./AssistantConversationEditor.tsx"),
      read("./AssistantPrefsModals.tsx"),
      read("./AssistantArtifactDetail.tsx"),
    ]);

    expect(allChats).not.toContain(".island");
    expect(allChats).toContain("panelDialogFixedOptions");
    expect(allChatsList).toContain("<Link");
    expect(allChatsList).toContain("assistantConversationHref");
    for (const source of [conversationEditor, preferences, artifacts]) {
      expect(source).not.toContain("h-[86vh]");
      expect(source).toContain("dialog-fixed-frame");
    }
  });
});
