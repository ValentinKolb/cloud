import { describe, expect, test } from "bun:test";
import { DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS } from "./mail-conversation-toolbar";
import { readMailWorkspacePreferences } from "./mail-workspace-preferences";

describe("Mail workspace preferences", () => {
  test("reads the list layout preference", () => {
    const value = encodeURIComponent(
      JSON.stringify({ listCollapsed: true, detailsOpen: true, toolbarActions: ["tags", "reply", "archive"] }),
    );
    expect(readMailWorkspacePreferences(`cloud_mail_workspace=${value}`)).toEqual({
      listCollapsed: true,
      detailsOpen: true,
      toolbarActions: ["reply", "archive", "tags"],
    });
  });

  test("keeps an intentionally empty toolbar", () => {
    const value = encodeURIComponent(JSON.stringify({ toolbarActions: [] }));
    expect(readMailWorkspacePreferences(`cloud_mail_workspace=${value}`).toolbarActions).toEqual([]);
  });

  test("ignores invalid and removed preferences", () => {
    const value = encodeURIComponent(JSON.stringify({ listCollapsed: false, shortcutOverrides: { archive: "e" } }));
    expect(readMailWorkspacePreferences(`cloud_mail_workspace=${value}`)).toEqual({
      listCollapsed: false,
      detailsOpen: false,
      toolbarActions: DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS,
    });
    expect(readMailWorkspacePreferences("cloud_mail_workspace=%7Bbroken")).toEqual({
      listCollapsed: false,
      detailsOpen: false,
      toolbarActions: DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS,
    });
  });
});
