import { describe, expect, test } from "bun:test";
import type { WorkflowCatalog } from "../service/workflows";
import { buildWorkflowCatalog } from "../service/workflows";
import { buildWorkflowIntelligence, workflowDiagnostics } from "./intelligence";

const catalog = (): WorkflowCatalog =>
  buildWorkflowCatalog({
    tables: [
      { id: "items", shortId: "itms1", name: "Items" },
      { id: "loans", shortId: "loan1", name: "Loans" },
    ],
    fieldsByTable: new Map([
      [
        "items",
        [
          { id: "status", shortId: "stat1", name: "Status" },
          { id: "label", shortId: "lbl01", name: "Label code" },
        ],
      ],
    ]),
    templates: [{ id: "template-label", shortId: "lab01", tableId: "items", name: "Item label" }],
    emailTemplates: [{ id: "email-paid", shortId: "mail1", name: "Paid invoice email" }],
  });

const labels = (source: string) =>
  buildWorkflowIntelligence({ source, caret: source.length, catalog: catalog() }).map((item) => item.label);

const item = (source: string, label: string) =>
  buildWorkflowIntelligence({ source, caret: source.length, catalog: catalog() }).find((entry) => entry.label === label);

describe("workflow YAML intelligence", () => {
  test("suggests top-level workflow keys", () => {
    expect(labels("tr")).toContain("triggers");
    expect(item("tr", "triggers")?.textEdit).toMatchObject({ start: 0, end: 2, text: "triggers:\n  " });
    expect(labels("na")).not.toContain("name");
    expect(labels("de")).not.toContain("description");
  });

  test("suggests trigger kinds inside triggers", () => {
    expect(labels("triggers:\n  sc")).toContain("scanner");
    expect(item("triggers:\n  sc", "scanner")?.textEdit.text).toContain("scanner:");
  });

  test("suggests workflow result actions", () => {
    expect(labels("steps:\n  - su")).toContain("succeed");
    expect(item("steps:\n  - su", "succeed")?.textEdit.text).toContain("message:");
  });

  test("filters trigger input suggestions by declared input type", () => {
    const source = `inputs:
  item:
    type: record
    table: Items
  items:
    type: recordList
    table: Items
triggers:
  scanner:
    input: `;
    expect(labels(source)).toContain("item");
    expect(labels(source)).not.toContain("items");

    const bulk = source.replace("scanner", "bulkSelection");
    expect(labels(bulk)).toContain("items");
    expect(labels(bulk)).not.toContain("item");
  });

  test("suggests permission-shaped tables, templates, and fields", () => {
    expect(labels("inputs:\n  item:\n    type: record\n    table: ")).toEqual(expect.arrayContaining(["Items", "Loans"]));
    expect(labels("steps:\n  - generateDocument:\n      template: ")).toContain("Item label");
    expect(labels("steps:\n  - sendEmail:\n      template: ")).toContain("Paid invoice email");
    expect(labels("triggers:\n  scanner:\n    resolve:\n      by: field\n      field: ")).toEqual(
      expect.arrayContaining(["Label code", "Status"]),
    );
  });

  test("diagnostics validate against the supplied catalog", () => {
    expect(
      workflowDiagnostics(
        `inputs:
  item:
    type: record
    table: Hidden table
triggers:
  form: {}
steps:
  - fail:
      message: stop
`,
        catalog(),
      ).map((diagnostic) => diagnostic.message),
    ).toEqual(['inputs.item.table: unknown table "Hidden table"']);
  });
});
