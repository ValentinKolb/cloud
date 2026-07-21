import { describe, expect, test } from "bun:test";
import { normalizeMailShortcut, readMailWorkspacePreferences } from "./mail-workspace-preferences";

describe("Mail workspace shortcuts", () => {
  test("normalizes logical international-layout shortcuts and rejects AltGraph-like combinations", () => {
    expect(normalizeMailShortcut("Shift + Ü")).toBe("shift+ü");
    expect(normalizeMailShortcut("Mod+Alt+K")).toBe("mod+alt+k");
    expect(normalizeMailShortcut("Ctrl+Alt+Q")).toBeNull();
    expect(normalizeMailShortcut("Shift+K+J")).toBeNull();
    expect(normalizeMailShortcut("Escape")).toBe("esc");
    expect(normalizeMailShortcut("Shift+Escape")).toBe("shift+esc");
  });

  test("keeps valid overrides and drops unknown or invalid values", () => {
    const value = encodeURIComponent(
      JSON.stringify({
        listCollapsed: true,
        shortcutOverrides: {
          archive: "shift+ü",
          trash: null,
          unknown: "x",
          flag: "ctrl+alt+q",
        },
      }),
    );
    expect(readMailWorkspacePreferences(`cloud_mail_workspace=${value}`)).toEqual({
      listCollapsed: true,
      shortcutOverrides: { archive: "shift+ü", trash: null },
    });
  });
});
