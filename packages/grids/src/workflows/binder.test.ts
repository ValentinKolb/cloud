import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { buildWorkflowCatalog, type WorkflowCatalog } from "../service/workflow-catalog";
import { bindGridsWorkflow } from "./binder";
import { gridsWorkflowManifest } from "./manifest";

const ids = {
  items: "11111111-1111-4111-8111-111111111111",
  archive: "22222222-2222-4222-8222-222222222222",
  name: "33333333-3333-4333-8333-333333333333",
  status: "44444444-4444-4444-8444-444444444444",
  archivedName: "55555555-5555-4555-8555-555555555555",
  document: "66666666-6666-4666-8666-666666666666",
  email: "77777777-7777-4777-8777-777777777777",
} as const;

const catalog = (): WorkflowCatalog =>
  buildWorkflowCatalog({
    tables: [
      { id: ids.items, shortId: "tbl_items", name: "Items" },
      { id: ids.archive, shortId: "tbl_archive", name: "Archive" },
    ],
    fieldsByTable: new Map([
      [
        ids.items,
        [
          { id: ids.name, shortId: "fld_name", name: "Name" },
          { id: ids.status, shortId: "fld_status", name: "Status" },
        ],
      ],
      [ids.archive, [{ id: ids.archivedName, shortId: "fld_archived_name", name: "Name" }]],
    ]),
    templates: [{ id: ids.document, shortId: "doc_item", name: "Item sheet", tableId: ids.items }],
    emailTemplates: [{ id: ids.email, shortId: "mail_ready", name: "Ready notice" }],
  });

const compile = async (source: string) => {
  const result = await compileWorkflow(source, gridsWorkflowManifest);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.ir;
};

describe("Grids workflow binder", () => {
  test("binds human-readable resources and fields to stable path-keyed IDs", async () => {
    const source = `inputs:
  item:
    type: record
    table: Items
    required: true
  items:
    type: recordList
    table: Items
triggers:
  recordEvent:
    event: updated
    filter:
      fieldId: Status
      op: equals
      value: Ready
    with:
      item: "\${{ trigger.record }}"
steps:
  - forEach: inputs.items
    as: item
    do:
      - updateRecord:
          record: item
          set:
            Status: Ready
      - generateDocument:
          template: Item sheet
          record: item
          saveAs: sheet
      - createDocumentLink:
          document: sheet
          saveAs: link
      - sendEmail:
          template: Ready notice
          to:
            - email: "\${{ item.Name }}"
          data:
            filename: "\${{ sheet.filename }}"
`;
    const ir = await compile(source);
    const result = await bindGridsWorkflow(ir, catalog());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.bindings).toEqual({
      "inputs.item.table": ids.items,
      "inputs.items.table": ids.items,
      "steps.0.do.0.updateRecord.set.Status": ids.status,
      "steps.0.do.1.generateDocument.template": ids.document,
      "steps.0.do.3.sendEmail.template": ids.email,
      "steps.0.do.3.sendEmail.to.0.email": ids.name,
      "triggers.recordEvent.filter.fieldId": ids.status,
      "triggers.recordEvent.table": ids.items,
    });
    expect(result.plan.catalogHash).toHaveLength(64);
    expect(result.plan.manifestHash).toHaveLength(64);
    expect(await bindGridsWorkflow(ir, catalog())).toEqual(result);
  });

  test("reports permission-filtered and ambiguous catalog misses at source locations", async () => {
    const source = `inputs:
  item:
    type: record
    table: Hidden
steps:
  - sendEmail:
      template: Notice
      to:
        - email: user@example.test
`;
    const visible = buildWorkflowCatalog({
      tables: [],
      emailTemplates: [
        { id: ids.email, shortId: "first", name: "Notice" },
        { id: "88888888-8888-4888-8888-888888888888", shortId: "second", name: "Notice" },
      ],
    });
    const result = await bindGridsWorkflow(await compile(source), visible);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "binding.unknown", path: ["inputs", "item", "table"] },
      { code: "binding.ambiguous", path: ["steps", 0, "sendEmail", "template"] },
    ]);
    expect(result.diagnostics[0]?.message).toContain("Unknown or inaccessible table");
    expect(result.diagnostics[0]?.location).toEqual({ offset: source.indexOf("table: Hidden"), line: 4, column: 5 });
    expect(result.diagnostics[1]?.location).toEqual({ offset: source.indexOf("template: Notice"), line: 7, column: 7 });
  });

  test("validates reference types, lexical scopes, saveAs, and forEach", async () => {
    const source = `inputs:
  item:
    type: record
    table: Items
steps:
  - generateDocument:
      template: Item sheet
      record: inputs.item
      saveAs: output
  - createDocumentLink:
      document: inputs.item
      saveAs: output
  - forEach: inputs.item
    as: row
    do:
      - setVariable:
          name: inside
          value: "\${{ row.Name }}"
  - setVariable:
      name: after
      value: "\${{ row.Name }}"
`;
    const result = await bindGridsWorkflow(await compile(source), catalog());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual(
      expect.arrayContaining([
        { code: "reference.type", path: ["steps", 1, "createDocumentLink", "document"] },
        { code: "scope.duplicate", path: ["steps", 1, "createDocumentLink", "saveAs"] },
        { code: "reference.type", path: ["steps", 2, "forEach"] },
        { code: "reference.unknown", path: ["steps", 3, "setVariable", "value"] },
      ]),
    );
  });

  test("validates trigger with completeness, event types, and record table scope", async () => {
    const source = `inputs:
  item:
    type: record
    table: Archive
    required: true
  count:
    type: number
    required: true
  echo:
    type: text
triggers:
  recordEvent:
    event: updated
    table: Items
    with:
      item: "\${{ trigger.record }}"
      count: "\${{ trigger.occurredAt }}"
      echo: "\${{ inputs.echo }}"
steps:
  - succeed:
      message: done
`;
    const result = await bindGridsWorkflow(await compile(source), catalog());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual(
      expect.arrayContaining([
        { code: "binding.scope", path: ["triggers", "recordEvent", "with", "item"] },
        { code: "trigger.type", path: ["triggers", "recordEvent", "with", "count"] },
        { code: "reference.scope", path: ["triggers", "recordEvent", "with", "echo"] },
      ]),
    );

    const missingSource = source.replace('      count: "${{ trigger.occurredAt }}"\n', "");
    const missing = await bindGridsWorkflow(await compile(missingSource), catalog());
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics).toContainEqual(
        expect.objectContaining({ code: "trigger.required", path: ["triggers", "recordEvent", "with", "count"] }),
      );
    }
  });

  test("rejects unavailable record-event values instead of guessing", async () => {
    const result = await bindGridsWorkflow(
      await compile(`inputs:
  item:
    type: record
    table: Items
    required: true
triggers:
  recordEvent:
    event: updated
    table: Items
    with:
      item: "\${{ trigger.before }}"
steps:
  - succeed:
      message: done
`),
      catalog(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "reference.unknown", path: ["triggers", "recordEvent", "with", "item"] }),
      );
    }
  });

  test("rejects fields and document templates from a different table", async () => {
    const source = `inputs:
  archived:
    type: record
    table: Archive
steps:
  - updateRecord:
      record: inputs.archived
      set:
        Status: Ready
  - generateDocument:
      template: Item sheet
      record: inputs.archived
`;
    const result = await bindGridsWorkflow(await compile(source), catalog());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "binding.unknown", path: ["steps", 0, "updateRecord", "set", "Status"] },
      { code: "binding.scope", path: ["steps", 1, "generateDocument", "record"] },
    ]);
  });

  test("supports now in trigger bindings and requires raw syntax in dedicated reference slots", async () => {
    const schedule = await bindGridsWorkflow(
      await compile(`inputs:
  at:
    type: dateTime
    required: true
triggers:
  schedule:
    cron: "0 8 * * *"
    with:
      at: "\${{ now() }}"
steps:
  - succeed:
      message: done
`),
      catalog(),
    );
    expect(schedule.ok).toBe(true);

    const wrapped = await bindGridsWorkflow(
      await compile(`inputs:
  item:
    type: record
    table: Items
steps:
  - updateRecord:
      record: "\${{ inputs.item }}"
      set:
        Status: Ready
`),
      catalog(),
    );
    expect(wrapped.ok).toBe(false);
    if (!wrapped.ok) {
      expect(wrapped.diagnostics).toContainEqual(
        expect.objectContaining({ code: "reference.invalid", path: ["steps", 0, "updateRecord", "record"] }),
      );
    }
  });

  test.each([
    ["61 8 * * *", "UTC", "cron minute field is invalid"],
    ["0 8 * * *", "Mars/Olympus", "timezone must be an IANA timezone"],
  ])("rejects invalid schedules during binding", async (cron, timezone, message) => {
    const result = await bindGridsWorkflow(
      await compile(`triggers:
  schedule:
    cron: "${cron}"
    timezone: ${timezone}
steps:
  - succeed:
      message: done
`),
      catalog(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "schedule.invalid", message: expect.stringContaining(message), path: ["triggers", "schedule"] }),
      );
    }
  });

  test("binds recursive conditions and validates text operand types", async () => {
    const result = await bindGridsWorkflow(
      await compile(`inputs:
  item:
    type: record
    table: Items
  label:
    type: text
  count:
    type: number
steps:
  - if:
      all:
        - contains: ["\${{ inputs.item.Name }}", "\${{ inputs.label }}"]
        - not:
            any:
              - startsWith: ["\${{ inputs.count }}", "1"]
              - exists: inputs.item.Status
        - endsWith: [null, "suffix"]
    then:
      - succeed:
          message: matched
`),
      catalog(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "condition.type",
        path: ["steps", 0, "if", "all", 1, "not", "any", 0, "startsWith", 0],
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "condition.type", path: ["steps", 0, "if", "all", 2, "endsWith", 0] }),
    );
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "reference.unknown" }));
  });
});
