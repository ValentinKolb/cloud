import { describe, expect, test } from "bun:test";
import { parseGridsQueryDsl } from "../query-dsl/parser";
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

  test("covers the product areas a new user must be able to discover", () => {
    const tables = gridsHelp.getMarkdown("grids-tables-fields")!;
    for (const fieldType of [
      "Text",
      "Long text",
      "Number",
      "Percent",
      "Boolean",
      "Date",
      "Duration",
      "Select",
      "JSON",
      "File",
      "Relation",
      "Lookup",
      "Rollup",
      "Formula",
      "ID",
    ]) {
      expect(tables, `missing field type ${fieldType}`).toContain(fieldType);
    }

    const formsDashboards = gridsHelp.getMarkdown("grids-forms-dashboards")!;
    for (const capability of ["Public form", "Number", "Records", "Chart", "Summary", "Form", "Text", "Link", "Workflow"]) {
      expect(formsDashboards, `missing forms or dashboard capability ${capability}`).toContain(capability);
    }
    expect(formsDashboards).toContain("saved view");
    expect(formsDashboards).toContain("Query");
    expect(formsDashboards).toContain("stored directly in the widget");

    const documents = gridsHelp.getMarkdown("grids-documents-pdfs")!;
    for (const capability of ["recursive snapshot", "public link", "1, 7, 30, or 90 days", "barcode_data_url"]) {
      expect(documents, `missing document capability ${capability}`).toContain(capability);
    }

    const permissions = gridsHelp.getMarkdown("grids-permissions")!;
    expect(permissions).toContain("Cloud administrators are not automatic Grids superusers");
    for (const resource of ["Base", "Stored table", "Combined table", "View", "Form", "Dashboard", "Document template", "Workflow"]) {
      expect(permissions, `missing permission resource ${resource}`).toContain(resource);
    }
  });

  test("keeps every GQL-fenced help example accepted by the public parser", () => {
    const markdown = gridsHelp.getMarkdown("grids-gql")!;
    const examples = [...markdown.matchAll(/```gql\n([\s\S]*?)```/g)].map((match) => match[1]!.trim());

    expect(examples.length).toBeGreaterThan(0);
    for (const source of examples) {
      const parsed = parseGridsQueryDsl(source);
      expect(parsed.ok, source).toBe(true);
    }
  });
});
