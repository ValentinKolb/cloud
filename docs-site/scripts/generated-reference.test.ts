import { expect, test } from "bun:test";
import {
  generatedAnchors,
  generatedReferenceHeader,
  isGeneratedReference,
  obsoleteGeneratedReferences,
  portableWebsiteTarget,
} from "./generated-reference";

test("only marks generator-owned references as generated", () => {
  expect(isGeneratedReference(`${generatedReferenceHeader}\n# Generated`)).toBe(true);
  expect(isGeneratedReference("# Hand-written reference")).toBe(false);
});

test("removes only obsolete generator-owned references", () => {
  expect(
    obsoleteGeneratedReferences(
      [
        {
          name: "obsolete.md",
          source: `${generatedReferenceHeader}\n# Obsolete`,
        },
        { name: "manual.md", source: "# Manual" },
        {
          name: "current.md",
          source: `${generatedReferenceHeader}\n# Current`,
        },
      ],
      new Set(["current.md"]),
    ),
  ).toEqual(["obsolete.md"]);
});

test("rejects duplicate generated anchors", () => {
  expect(() => generatedAnchors('<a id="page"></a>\n# Page\n<a id="page"></a>\n## Again', "reference.md")).toThrow(
    "reference.md: duplicate generated anchor page",
  );
});

test("maps the website-only UI catalog to the portable component reference", () => {
  expect(portableWebsiteTarget("/ui")).toBe("./components.md");
  expect(portableWebsiteTarget("/ui/panel-header")).toBe("./components.md");
  expect(portableWebsiteTarget("/docs/en/frontend")).toBe("/docs/en/frontend");
});
