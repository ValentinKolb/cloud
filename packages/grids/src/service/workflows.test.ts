import { describe, expect, test } from "bun:test";
import { parseWorkflowYaml } from "../workflows/dsl";
import type { WorkflowCatalog } from "./workflows";
import { validateWorkflowReferences } from "./workflows";

type CatalogEntry = { id: string; shortId: string; name: string };
type TemplateEntry = CatalogEntry & { tableId: string };
type CatalogInput = {
  tables: CatalogEntry[];
  fields?: Record<string, CatalogEntry[]>;
  templates?: TemplateEntry[];
  emailTemplates?: CatalogEntry[];
};

const index = <T extends CatalogEntry>(entries: T[]) => {
  const refs = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const entry of entries) {
    for (const key of [entry.id, entry.shortId, entry.name]) {
      const existing = refs.get(key);
      if (existing && existing.id !== entry.id) ambiguous.add(key);
      else refs.set(key, entry);
    }
  }
  return { refs, ambiguous };
};

const catalog = (input: CatalogInput): WorkflowCatalog => ({
  tables: index(input.tables),
  fieldsByTable: new Map(Object.entries(input.fields ?? {}).map(([tableId, fields]) => [tableId, index(fields)])),
  templates: index(input.templates ?? []),
  emailTemplates: index(input.emailTemplates ?? []),
});

const parseDefinition = (source: string) => {
  const result = parseWorkflowYaml(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  return result.definition;
};

describe("workflow reference validation", () => {
  test("accepts known tables, fields, and same-table document templates", () => {
    const definition = parseDefinition(`
inputs:
  item:
    type: record
    table: Items
triggers:
  scanner:
    input: item
    resolve:
      by: field
      field: Label code
steps:
  - updateRecord:
      record: inputs.item
      set:
        Status: Available
  - generateDocument:
      template: Item label
      record: inputs.item
`);

    expect(
      validateWorkflowReferences(
        definition,
        catalog({
          tables: [{ id: "table-items", shortId: "itms1", name: "Items" }],
          fields: {
            "table-items": [
              { id: "field-status", shortId: "stat1", name: "Status" },
              { id: "field-label", shortId: "lbl01", name: "Label code" },
            ],
          },
          templates: [{ id: "template-label", shortId: "lab01", tableId: "table-items", name: "Item label" }],
        }),
      ),
    ).toEqual([]);
  });

  test("rejects unknown fields and document templates for a different table", () => {
    const definition = parseDefinition(`
inputs:
  item:
    type: record
    table: Items
triggers:
  api: {}
steps:
  - updateRecord:
      record: inputs.item
      set:
        Missing: Available
  - createRecord:
      table: Movements
      values:
        Item: "\${{ inputs.item }}"
  - generateDocument:
      template: Loan contract
      record: inputs.item
`);

    expect(
      validateWorkflowReferences(
        definition,
        catalog({
          tables: [
            { id: "table-items", shortId: "itms1", name: "Items" },
            { id: "table-loans", shortId: "loan1", name: "Loans" },
          ],
          fields: {
            "table-items": [{ id: "field-status", shortId: "stat1", name: "Status" }],
          },
          templates: [{ id: "template-loan", shortId: "loanp", tableId: "table-loans", name: "Loan contract" }],
        }),
      ),
    ).toEqual([
      'updateRecord.set: unknown field "Missing"',
      'createRecord.table: unknown reference "Movements"',
      "createRecord.values: unknown table",
      "generateDocument.record: record table must match the document template table",
    ]);
  });

  test("rejects ambiguous table, field, and template names instead of guessing", () => {
    const definition = parseDefinition(`
inputs:
  item:
    type: record
    table: Items
triggers:
  scanner:
    input: item
    resolve:
      by: field
      field: Label
steps:
  - generateDocument:
      template: Label
      record: inputs.item
`);

    expect(
      validateWorkflowReferences(
        definition,
        catalog({
          tables: [
            { id: "table-a", shortId: "items", name: "Items" },
            { id: "table-b", shortId: "kits1", name: "Items" },
          ],
          fields: {
            "table-a": [
              { id: "field-a", shortId: "la001", name: "Label" },
              { id: "field-b", shortId: "lb001", name: "Label" },
            ],
          },
          templates: [
            { id: "template-a", shortId: "ta001", tableId: "table-a", name: "Label" },
            { id: "template-b", shortId: "tb001", tableId: "table-a", name: "Label" },
          ],
        }),
      ),
    ).toEqual([
      'inputs.item.table: ambiguous table "Items"',
      "triggers.scanner.resolve.field: unknown table",
      'generateDocument.template: ambiguous reference "Label"',
    ]);
  });

  test("rejects invalid schedule cron expressions", () => {
    const definition = parseDefinition(`
triggers:
  schedule:
    cron: "* * * * * *"
steps:
  - fail:
      message: stop
`);

    expect(validateWorkflowReferences(definition, catalog({ tables: [] }))).toEqual([
      "triggers.schedule: schedule cron must have 5 fields",
    ]);
  });

  test("rejects record event trigger table/input mismatches", () => {
    const definition = parseDefinition(`
inputs:
  item:
    type: record
    table: Items
triggers:
  recordEvent:
    event: updated
    input: item
    table: Loans
steps:
  - fail:
      message: stop
`);

    expect(
      validateWorkflowReferences(
        definition,
        catalog({
          tables: [
            { id: "table-items", shortId: "itms1", name: "Items" },
            { id: "table-loans", shortId: "loan1", name: "Loans" },
          ],
        }),
      ),
    ).toEqual(["triggers.recordEvent.input: input table must match triggers.recordEvent.table"]);
  });

  test("accepts document links and email templates in workflow steps", () => {
    const definition = parseDefinition(`
inputs:
  item:
    type: record
    table: Items
triggers:
  form: {}
steps:
  - generateDocument:
      template: Item label
      record: inputs.item
      saveAs: labelPdf
  - createDocumentLink:
      document: labelPdf
      expiresIn: 30d
      saveAs: labelLink
  - sendEmail:
      template: Label email
      to:
        - email: "customer@example.test"
      data:
        link: "\${{ labelLink }}"
      saveAs: sentEmail
`);

    expect(
      validateWorkflowReferences(
        definition,
        catalog({
          tables: [{ id: "table-items", shortId: "itms1", name: "Items" }],
          templates: [{ id: "template-label", shortId: "lab01", tableId: "table-items", name: "Item label" }],
          emailTemplates: [{ id: "email-label", shortId: "eml01", name: "Label email" }],
        }),
      ),
    ).toEqual([]);
  });

  test("validates loop-scoped records through nested control-flow branches", () => {
    const definition = parseDefinition(`
inputs:
  items:
    type: recordList
    table: Items
triggers:
  bulkSelection:
    input: items
steps:
  - forEach: inputs.items
    as: item
    do:
      - updateRecord:
          record: item
          set:
            Missing loop field: true
      - if:
          exists: item.Name
        then:
          - updateRecord:
              record: item
              set:
                Missing then field: true
        else:
          - updateRecord:
              record: item
              set:
                Missing else field: true
      - switch: "\${{ item.Status }}"
        cases:
          - when: Available
            do:
              - updateRecord:
                  record: item
                  set:
                    Missing case field: true
        default:
          - updateRecord:
              record: item
              set:
                Missing default field: true
`);

    expect(
      validateWorkflowReferences(
        definition,
        catalog({
          tables: [{ id: "table-items", shortId: "itms1", name: "Items" }],
          fields: {
            "table-items": [
              { id: "field-name", shortId: "name1", name: "Name" },
              { id: "field-status", shortId: "stat1", name: "Status" },
            ],
          },
        }),
      ),
    ).toEqual([
      'updateRecord.set: unknown field "Missing loop field"',
      'updateRecord.set: unknown field "Missing then field"',
      'updateRecord.set: unknown field "Missing else field"',
      'updateRecord.set: unknown field "Missing case field"',
      'updateRecord.set: unknown field "Missing default field"',
    ]);
  });

  test("rejects unknown workflow email templates", () => {
    const definition = parseDefinition(`
triggers:
  api: {}
steps:
  - sendEmail:
      template: Missing email
      to:
        - email: "customer@example.test"
`);

    expect(validateWorkflowReferences(definition, catalog({ tables: [], emailTemplates: [] }))).toEqual([
      'sendEmail.template: unknown reference "Missing email"',
    ]);
  });

  test("validates dynamic record fields in nested values and messages", () => {
    const definition = parseDefinition(`
inputs:
  item:
    type: record
    table: Items
triggers:
  api: {}
steps:
  - httpRequest:
      url: https://example.com/hook
      json:
        known: "\${{ inputs.item.Name }}"
        missing: "\${{ inputs.item.Missing }}"
  - succeed:
      message: "Updated \${{ inputs.item.Other missing }}"
`);

    expect(
      validateWorkflowReferences(
        definition,
        catalog({
          tables: [{ id: "table-items", shortId: "itms1", name: "Items" }],
          fields: { "table-items": [{ id: "field-name", shortId: "name1", name: "Name" }] },
        }),
      ),
    ).toEqual(['httpRequest.json.missing: unknown field "Missing"', 'succeed.message: unknown field "Other missing"']);
  });

  test("propagates created record tables into later dynamic values", () => {
    const definition = parseDefinition(`
triggers:
  api: {}
steps:
  - createRecord:
      table: Items
      values:
        Name: Created
      saveAs: created
  - httpRequest:
      url: https://example.com/hook
      json:
        missing: "\${{ created.Missing }}"
`);

    expect(
      validateWorkflowReferences(
        definition,
        catalog({
          tables: [{ id: "table-items", shortId: "itms1", name: "Items" }],
          fields: { "table-items": [{ id: "field-name", shortId: "name1", name: "Name" }] },
        }),
      ),
    ).toEqual(['httpRequest.json.missing: unknown field "Missing"']);
  });
});
