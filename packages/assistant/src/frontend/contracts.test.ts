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

  test("keeps Projects and chat context inside the Assistant workspace", async () => {
    const [workspace, sidebar, project, context] = await Promise.all([
      read("./AssistantWorkspace.island.tsx"),
      read("./AssistantSidebar.tsx"),
      read("./AssistantProjectView.tsx"),
      read("./AssistantChatContext.tsx"),
    ]);

    expect(sidebar).toContain("AppWorkspace.NavTree");
    expect(project).toContain("Search Project chats");
    expect(project).toContain("IntersectionObserver");
    expect(workspace).toContain("AssistantChatContextPanel");
    expect(context).toContain("openAssistantSourcesDialog");
  });

  test("frames structured memories as personalization", async () => {
    const [preferences, client] = await Promise.all([read("./AssistantPrefsModals.tsx"), read("../api/client.ts")]);

    expect(preferences).toContain("Learn personalization from private chats");
    expect(preferences).toContain("Search personalization");
    expect(preferences).toContain("Add personalization");
    expect(preferences).toContain("SettingsCollection.Item.Actions");
    expect(preferences).toContain("System prompt");
    expect(preferences).not.toContain("Custom instructions");
    expect(preferences).not.toContain("PanelDialog");
    expect(preferences).toContain('size: "medium"');
    expect(preferences).toContain("lines={4}");
    expect(preferences).toContain("Pin");
    expect(preferences).toContain("Forget");
    expect(client).toContain("createMemory");
    expect(client).toContain("updateMemory");
    expect(client).toContain("deleteMemory");
    expect(client).not.toContain("memory?: string");
  });
});
