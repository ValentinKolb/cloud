import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  parseDetailPanelOpen,
  parseSettings,
  readSettings,
  setDetailPanelOpen,
  setLastNotebookId,
  writeSettings,
} from "./NotebookSettingsStore";

const COOKIE_NAME = "settings-app-notebooks";
let cookie = "";

const cookieHeader = () => cookie;

beforeEach(() => {
  cookie = "";
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        cookie = value.split(";", 1)[0] ?? "";
      },
    },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:" },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "location");
});

describe("NotebookSettingsStore", () => {
  test("clears a persisted source-mode override when switching back to rich mode", () => {
    writeSettings("first", { richMode: "source" });
    expect(readSettings("first").richMode).toBe("source");

    writeSettings("first", { richMode: "rich" });

    expect(readSettings("first").richMode).toBe("rich");
    expect(parseSettings(cookieHeader(), "first").richMode).toBe("rich");
  });

  test("preserves preferences for other notebooks and when changing the last notebook", () => {
    writeSettings("first", { richMode: "source" });
    writeSettings("second", { lastNoteId: "note-2" });
    setLastNotebookId("second");

    expect(parseSettings(cookieHeader(), "first").richMode).toBe("source");
    expect(parseSettings(cookieHeader(), "second").lastNoteId).toBe("note-2");
  });

  test("persists detail-panel visibility for server rendering", () => {
    setDetailPanelOpen(true);
    expect(parseDetailPanelOpen(cookieHeader())).toBe(true);

    setDetailPanelOpen(false);
    expect(parseDetailPanelOpen(cookieHeader())).toBe(false);
    expect(decodeURIComponent(cookie)).toContain(COOKIE_NAME);
  });
});
