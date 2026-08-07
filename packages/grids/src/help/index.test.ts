import { describe, expect, test } from "bun:test";
import { AGGREGATE_KINDS } from "../aggregate-catalog";
import { DOCUMENT_TEMPLATE_STARTERS } from "../document-template-starters";
import { GRID_FORMULA_FUNCTIONS } from "../formula/function-catalog";
import { parseFormula } from "../formula/parser";
import {
  GROUP_GRANULARITIES,
  PREDICATE_COMPARISON_OPERATORS,
  PREDICATE_FUNCTIONS,
  PREDICATE_OPERATORS,
} from "../query-dsl/intelligence-grammar";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { gridsHelp } from ".";

const cliSkillReference = await Bun.file(new URL("../../../../skills/cloud-cli/references/grids.md", import.meta.url)).text();

const expectedTopics = [
  "grids-overview",
  "grids-core-model",
  "grids-build-base",
  "grids-tables-fields",
  "grids-views-reports",
  "grids-combined-tables",
  "grids-gql",
  "grids-formulas",
  "grids-forms",
  "grids-documents-pdfs",
  "grids-custom-apps",
  "grids-workflows",
  "grids-permissions",
  "grids-operations-troubleshooting",
];

describe("grids help", () => {
  test("keeps every established topic in its existing order", () => {
    expect(gridsHelp.documents.map((document) => document.id)).toEqual(expectedTopics);
  });

  test("serves the established reference content from Markdown", () => {
    for (const document of gridsHelp.documents) {
      const markdown = gridsHelp.getMarkdown(document.id);
      expect(markdown, `${document.id} should have Markdown content`).toBeDefined();
      expect(markdown!.trim().length).toBeGreaterThan(100);
    }

    expect(gridsHelp.getMarkdown("grids-gql")).toContain("from table Books");
    expect(gridsHelp.getMarkdown("grids-workflows")).toContain("A workflow does not need a YAML trigger");
    expect(gridsHelp.getMarkdown("grids-documents-pdfs")).toContain("Liquid + GQL");
    expect(gridsHelp.getMarkdown("grids-combined-tables")).toContain("Fail-closed publication");
  });

  test("keeps implementation stack details out of end-user help", () => {
    const markdown = gridsHelp.documents.map((document) => gridsHelp.getMarkdown(document.id)).join("\n");

    for (const implementationTerm of [
      /\bGotenberg\b/i,
      /\bPostgreSQL\b/i,
      /\bLiquidJS\b/i,
      /\bSQL\b/,
      /server cursors/i,
      /live event stream/i,
      /durable intents/i,
      /socket connection/i,
      /DNS address/i,
    ]) {
      expect(markdown).not.toMatch(implementationTerm);
    }
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

    const forms = gridsHelp.getMarkdown("grids-forms")!;
    for (const capability of ["Public form", "required inputs", "hidden values", "redirect", "Custom App"]) {
      expect(forms, `missing form capability ${capability}`).toContain(capability);
    }

    const customApps = gridsHelp.getMarkdown("grids-custom-apps")!;
    for (const capability of [
      "Markdown",
      "Records",
      "Metrics",
      "Chart",
      "Comments",
      "saved view",
      "apps validate",
      "apps plan",
      "apps apply",
      "apps publish",
    ]) {
      expect(customApps, `missing Custom App capability ${capability}`).toContain(capability);
    }
    expect(customApps).toContain("signed-in Cloud accounts only");

    const documents = gridsHelp.getMarkdown("grids-documents-pdfs")!;
    for (const capability of ["recursive snapshot", "public link", "1, 7, 30, or 90 days", "barcode_data_url"]) {
      expect(documents, `missing document capability ${capability}`).toContain(capability);
    }
    for (const starter of DOCUMENT_TEMPLATE_STARTERS) {
      expect(documents, `missing document starter ${starter.name}`).toContain(`\`${starter.name}\``);
    }

    const formulas = gridsHelp.getMarkdown("grids-formulas")!;
    for (const fn of GRID_FORMULA_FUNCTIONS) {
      expect(formulas, `missing formula function ${fn.name}`).toContain(fn.signature);
      expect(cliSkillReference, `CLI reference missing formula function ${fn.name}`).toContain(fn.signature);
    }

    const permissions = gridsHelp.getMarkdown("grids-permissions")!;
    expect(permissions).toContain("Cloud administrators are not automatic Grids superusers");
    expect(permissions).toContain("Saved views and document templates are deliberate included-data boundaries");
    expect(permissions).toContain("exact enabled launcher saved in a readable Custom App block");
    for (const resource of [
      "Base",
      "Stored table",
      "Combined table",
      "View",
      "Form",
      "Custom App",
      "Document template",
      "Workflow",
    ]) {
      expect(permissions, `missing permission resource ${resource}`).toContain(resource);
    }

    const gql = gridsHelp.getMarkdown("grids-gql")!;
    for (const term of [
      ...GROUP_GRANULARITIES,
      ...AGGREGATE_KINDS,
      ...PREDICATE_FUNCTIONS.map((item) => item.label),
      ...PREDICATE_OPERATORS.map((item) => item.label),
      ...PREDICATE_COMPARISON_OPERATORS.map((item) => item.label),
      "record.id",
      "record.createdBy",
      "record.updatedBy",
      "record.deletedBy",
      "record.createdAt",
      "record.updatedAt",
      "record.deletedAt",
    ]) {
      expect(gql, `missing GQL reference term ${term}`).toContain(term);
      expect(cliSkillReference, `CLI reference missing GQL term ${term}`).toContain(term);
    }

    expect(tables).toContain("browser's timezone");
    expect(documents).toContain('class="pageNumber"');
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

  test("keeps every formula help example accepted by the public parser", () => {
    const markdown = gridsHelp.getMarkdown("grids-formulas")!;
    const examples = [...markdown.matchAll(/```text\n([\s\S]*?)```/g)].map((match) => match[1]!.trim());

    expect(examples.length).toBeGreaterThan(0);
    for (const source of examples) {
      const parsed = parseFormula(source);
      expect(parsed.ok, source).toBe(true);
    }
  });
});
