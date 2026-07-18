import { describe, expect, test } from "bun:test";
import { gridsHelp } from ".";

const expectedTopics = [
  "grids-overview",
  "grids-core-model",
  "grids-build-base",
  "grids-tables-fields",
  "grids-views-reports",
  "grids-combined-tables",
  "grids-gql",
  "grids-formulas",
  "grids-forms-dashboards",
  "grids-documents-pdfs",
  "grids-workflows",
  "grids-permissions",
  "grids-operations-troubleshooting",
];

describe("grids help", () => {
  test("keeps every established topic in its existing order", () => {
    expect(gridsHelp.manifest.map((document) => document.id)).toEqual(expectedTopics);
  });

  test("serves the established reference content from Markdown", () => {
    for (const document of gridsHelp.manifest) {
      const markdown = gridsHelp.getMarkdown(document.id);
      expect(markdown, `${document.id} should have Markdown content`).toBeDefined();
      expect(markdown!.trim().length).toBeGreaterThan(100);
    }

    expect(gridsHelp.getMarkdown("grids-gql")).toContain("from table Books");
    expect(gridsHelp.getMarkdown("grids-workflows")).toContain("A workflow does not need a YAML trigger");
    expect(gridsHelp.getMarkdown("grids-documents-pdfs")).toContain("Liquid + GQL");
    expect(gridsHelp.getMarkdown("grids-combined-tables")).toContain("Fail-closed publication");
  });
});
