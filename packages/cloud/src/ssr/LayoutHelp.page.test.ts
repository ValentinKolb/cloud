import { describe, expect, test } from "bun:test";
import { layoutHelpTopicHref } from "./layout-help-url";

describe("layoutHelpTopicHref", () => {
  test("opens an app-owned Help topic", () => {
    expect(layoutHelpTopicHref("/app/assistant/help", "assistant-workflow")).toBe("/app/assistant/help/assistant-workflow");
  });

  test("returns the Help hub for a missing topic", () => {
    expect(layoutHelpTopicHref("/app/notebooks/help", null)).toBe("/app/notebooks/help");
  });

  test("normalizes a trailing slash and encodes the topic segment", () => {
    expect(layoutHelpTopicHref("/app/contacts/help/", "contacts/reach")).toBe("/app/contacts/help/contacts%2Freach");
  });
});
