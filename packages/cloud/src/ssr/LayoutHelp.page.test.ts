import { describe, expect, test } from "bun:test";
import { layoutHelpPageHref } from "./layout-help-url";

describe("layoutHelpPageHref", () => {
  test("opens the current app route at the selected Help topic", () => {
    expect(layoutHelpPageHref("https://cloud.test/app/assistant?conversation=42#latest", "assistant-workflow")).toBe(
      "/app/assistant?conversation=42&help=assistant-workflow#latest",
    );
  });

  test("uses an empty Help parameter for the Help hub", () => {
    expect(layoutHelpPageHref("https://cloud.test/app/notebooks", null)).toBe("/app/notebooks?help=");
  });

  test("replaces an existing Help topic without disturbing app state", () => {
    expect(layoutHelpPageHref("https://cloud.test/app/contacts?help=contacts-start&book=personal", "contacts-reach")).toBe(
      "/app/contacts?help=contacts-reach&book=personal",
    );
  });
});
