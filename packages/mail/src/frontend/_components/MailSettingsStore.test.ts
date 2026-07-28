import { describe, expect, test } from "bun:test";
import { normalizeMailComposerPanes, normalizeMailUserPreferences } from "./MailSettingsStore";

describe("Mail reading preferences", () => {
  test("defaults to safe HTML display and accepts an explicit plain-text preference", () => {
    expect(normalizeMailUserPreferences(undefined)).toMatchObject({
      composeFormat: "markdown",
      readingFormat: "html",
      undoSeconds: 10,
    });
    expect(normalizeMailUserPreferences({ readingFormat: "plain" })).toMatchObject({ readingFormat: "plain" });
    expect(normalizeMailUserPreferences({ readingFormat: "invalid" as "html" })).toMatchObject({ readingFormat: "html" });
  });
});

describe("Mail composer pane preferences", () => {
  test("keeps a valid split layout", () => {
    const value = {
      root: {
        type: "split" as const,
        id: "compose-root",
        direction: "horizontal" as const,
        sizes: [60, 40],
        children: [
          {
            type: "leaf" as const,
            id: "compose-editor",
            elementIds: ["editor"],
            activeElementId: "editor",
            presentation: "single" as const,
          },
          {
            type: "leaf" as const,
            id: "compose-preview",
            elementIds: ["preview"],
            activeElementId: "preview",
            presentation: "single" as const,
          },
        ],
      },
    };

    expect(normalizeMailComposerPanes(value)).toEqual(value);
  });

  test("falls back from malformed or colliding pane trees", () => {
    const duplicateNodeIds = {
      root: {
        type: "split",
        id: "duplicate",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          { type: "leaf", id: "duplicate", elementIds: ["editor"] },
          { type: "leaf", id: "preview", elementIds: ["preview"] },
        ],
      },
    };

    expect(normalizeMailComposerPanes(duplicateNodeIds).root).toMatchObject({
      type: "leaf",
      elementIds: ["editor", "preview"],
      activeElementId: "editor",
      presentation: "tabs",
    });
    expect(normalizeMailComposerPanes({ root: { type: "split" } }).root).toMatchObject({
      type: "leaf",
      elementIds: ["editor", "preview"],
    });
  });

  test("rejects unknown or missing elements", () => {
    expect(
      normalizeMailComposerPanes({
        root: {
          type: "leaf",
          id: "compose",
          elementIds: ["unknown", "preview"],
          activeElementId: "unknown",
          presentation: "tabs",
        },
      }).root,
    ).toMatchObject({
      type: "leaf",
      elementIds: ["editor", "preview"],
      activeElementId: "editor",
      presentation: "tabs",
    });
    expect(
      normalizeMailComposerPanes({
        root: {
          type: "leaf",
          id: "compose",
          elementIds: ["editor"],
          activeElementId: "editor",
          presentation: "single",
        },
      }).root,
    ).toMatchObject({
      type: "leaf",
      elementIds: ["editor", "preview"],
    });
  });

  test("rejects unsupported split directions and unusably small panes", () => {
    for (const root of [
      {
        type: "split",
        id: "vertical",
        direction: "vertical",
        sizes: [50, 50],
        children: [
          { type: "leaf", id: "editor", elementIds: ["editor"] },
          { type: "leaf", id: "preview", elementIds: ["preview"] },
        ],
      },
      {
        type: "split",
        id: "tiny",
        direction: "horizontal",
        sizes: [8, 1_000],
        children: [
          { type: "leaf", id: "editor", elementIds: ["editor"] },
          { type: "leaf", id: "preview", elementIds: ["preview"] },
        ],
      },
      {
        type: "leaf",
        id: "hidden-preview",
        elementIds: ["editor", "preview"],
        activeElementId: "editor",
        presentation: "single",
      },
    ]) {
      expect(normalizeMailComposerPanes({ root }).root).toMatchObject({
        type: "leaf",
        elementIds: ["editor", "preview"],
      });
    }
  });

  test("accepts proportional split weights after normalization", () => {
    const value = {
      root: {
        type: "split" as const,
        id: "weighted",
        direction: "horizontal" as const,
        sizes: [1, 1],
        children: [
          {
            type: "leaf" as const,
            id: "editor",
            elementIds: ["editor"],
            presentation: "single" as const,
          },
          {
            type: "leaf" as const,
            id: "preview",
            elementIds: ["preview"],
            presentation: "single" as const,
          },
        ],
      },
    };

    expect(normalizeMailComposerPanes(value)).toEqual(value);
  });
});
