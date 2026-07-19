import { describe, expect, test } from "bun:test";
import { formatHelpBundleMarkdown, formatHelpDocumentMarkdown } from "./layout-help-markdown";

describe("Help Markdown copy formatting", () => {
  test("adds the reader-visible title and description to an article", () => {
    expect(
      formatHelpDocumentMarkdown({
        title: "Getting started",
        description: "Learn the basics.",
        markdown: "Open the app and create your first item.\n",
      }),
    ).toBe("# Getting started\n\nLearn the basics.\n\nOpen the app and create your first item.\n");
  });

  test("bundles articles in their supplied manifest order", () => {
    expect(
      formatHelpBundleMarkdown([
        { title: "Start", description: "Begin here.", markdown: "First steps." },
        { title: "Reference", markdown: "Exact details." },
      ]),
    ).toBe("# Start\n\nBegin here.\n\nFirst steps.\n\n# Reference\n\nExact details.\n");
  });
});
