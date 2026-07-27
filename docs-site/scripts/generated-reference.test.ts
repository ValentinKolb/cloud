import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { GENERATED_REFERENCE_CONTENTS_THRESHOLD, referenceGroups, renderGroup, renderReference } from "./generate-cloud-dev-references";
import {
  generatedAnchors,
  generatedReferenceHeader,
  isGeneratedReference,
  obsoleteGeneratedReferences,
  portableWebsiteTarget,
} from "./generated-reference";

const listMarkdownFiles = (directory: string, root = directory): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(path, root);
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    return [relative(root, path).replaceAll(sep, "/")];
  });

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

test("includes every documentation page exactly once", () => {
  const docsRoot = resolve(import.meta.dir, "../docs/en");
  const docs = listMarkdownFiles(docsRoot).sort();
  const sources = referenceGroups.flatMap((group) => group.sources);
  const outputs = referenceGroups.map((group) => group.output);

  expect(docs).toHaveLength(79);
  expect(new Set(sources).size).toBe(sources.length);
  expect(new Set(outputs).size).toBe(outputs.length);
  expect([...sources].sort()).toEqual(docs);
});

test("adds contents only to references longer than the threshold", () => {
  const short = renderReference("Short reference", [
    {
      anchor: "page-short",
      markdown: '<a id="page-short"></a>\n## Short page\n\nShort body.',
      title: "Short page",
    },
  ]);
  const longBody = Array.from({ length: GENERATED_REFERENCE_CONTENTS_THRESHOLD }, (_, index) => `Line ${index + 1}`).join("\n");
  const long = renderReference("Long reference", [
    {
      anchor: "page-long",
      markdown: `<a id="page-long"></a>\n## Long page\n\n${longBody}`,
      title: "Long page",
    },
  ]);

  expect(short).not.toContain("## Contents");
  expect(long).toContain("## Contents\n\n- [Long page](#page-long)");
});

test("keeps every planned reference below the hard size limit", async () => {
  for (const group of referenceGroups) {
    const rendered = await renderGroup(group);
    const lines = rendered.split("\n").length;
    expect(lines).toBeLessThan(800);
    if (lines > GENERATED_REFERENCE_CONTENTS_THRESHOLD) {
      expect(rendered).toContain("## Contents");
    }
  }
});
