import { describe, expect, test } from "bun:test";
import { readMailWorkspacePreferences } from "./mail-workspace-preferences";

describe("Mail workspace preferences", () => {
  test("reads the list layout preference", () => {
    const value = encodeURIComponent(JSON.stringify({ listCollapsed: true, detailsOpen: true }));
    expect(readMailWorkspacePreferences(`cloud_mail_workspace=${value}`)).toEqual({ listCollapsed: true, detailsOpen: true });
  });

  test("ignores invalid and removed preferences", () => {
    const value = encodeURIComponent(JSON.stringify({ listCollapsed: false, shortcutOverrides: { archive: "e" } }));
    expect(readMailWorkspacePreferences(`cloud_mail_workspace=${value}`)).toEqual({ listCollapsed: false, detailsOpen: false });
    expect(readMailWorkspacePreferences("cloud_mail_workspace=%7Bbroken")).toEqual({ listCollapsed: false, detailsOpen: false });
  });
});
