import { describe, expect, test } from "bun:test";
import { parseWorkflowYaml } from "./dsl";

describe("workflow YAML DSL", () => {
  test("parses a scanner workflow into a typed definition", () => {
    const result = parseWorkflowYaml(`
inputs:
  item:
    type: record
    table: Items
    required: true
triggers:
  scanner:
    input: item
    resolve:
      by: field
      field: Label code
  form: {}
  api:
    enabled: true
steps:
  - if:
      equals: [inputs.item.Status, Loaned]
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: Available
            Last scanned at: now()
      - createRecord:
          table: Movements
          values:
            Item: inputs.item
            Type: Check-in
            Timestamp: now()
    else:
      - fail:
          message: Item is not currently loaned out.
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.inputs?.item?.type).toBe("record");
    expect(result.definition.triggers.scanner?.resolve?.by).toBe("field");
    expect(result.definition.steps).toHaveLength(1);
  });

  test("parses a bulk document workflow with loop-scoped record aliases", () => {
    const result = parseWorkflowYaml(`
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
      - generateDocument:
          template: Item label
          record: item
          batch: true
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.triggers.bulkSelection?.input).toBe("items");
  });

  test("rejects unknown keys instead of silently accepting dialect drift", () => {
    const result = parseWorkflowYaml(`
on:
  api: {}
triggers:
  api: {}
steps:
  - fail:
      message: stop
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("on"))).toBe(true);
  });

  test("rejects UI metadata in YAML", () => {
    const result = parseWorkflowYaml(`
name: Bad workflow
triggers:
  api: {}
steps:
  - fail:
      message: stop
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("name"))).toBe(true);
  });

  test("rejects scanner and bulk trigger input type mismatches", () => {
    const scanner = parseWorkflowYaml(`
inputs:
  items:
    type: recordList
    table: Items
triggers:
  scanner:
    input: items
steps:
  - fail:
      message: stop
`);

    expect(scanner.ok).toBe(false);
    if (!scanner.ok)
      expect(scanner.diagnostics.map((diagnostic) => diagnostic.message)).toContain("triggers.scanner.input must reference a record input");

    const bulk = parseWorkflowYaml(`
inputs:
  item:
    type: record
    table: Items
triggers:
  bulkSelection:
    input: item
steps:
  - fail:
      message: stop
`);

    expect(bulk.ok).toBe(false);
    if (!bulk.ok)
      expect(bulk.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
        "triggers.bulkSelection.input must reference a recordList input",
      );
  });

  test("rejects record event trigger input type mismatches", () => {
    const result = parseWorkflowYaml(`
inputs:
  items:
    type: recordList
    table: Items
triggers:
  recordEvent:
    event: updated
    input: items
steps:
  - fail:
      message: stop
`);

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
        "triggers.recordEvent.input must reference a record input",
      );
  });

  test("rejects record actions that target unknown or list references", () => {
    const result = parseWorkflowYaml(`
inputs:
  items:
    type: recordList
    table: Items
triggers:
  bulkSelection:
    input: items
steps:
  - updateRecord:
      record: inputs.items
      set:
        Status: Available
  - generateDocument:
      template: Item label
      record: inputs.missing
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "steps.0.updateRecord.record: record references recordList, expected record",
      "steps.1.generateDocument.record: record must reference a known record",
    ]);
  });

  test("keeps httpRequest explicit and JSON-only", () => {
    const ok = parseWorkflowYaml(`
triggers:
  api: {}
steps:
  - httpRequest:
      method: POST
      url: https://example.com/hooks/grids
      headers:
        X-App: Grids
      json:
        event: document.generated
`);
    expect(ok.ok).toBe(true);

    const rejected = parseWorkflowYaml(`
triggers:
  api: {}
steps:
  - httpRequest:
      url: ftp://example.com
      body: raw
`);

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.some((diagnostic) => diagnostic.message.includes("URL must use http or https"))).toBe(true);
      expect(rejected.diagnostics.some((diagnostic) => diagnostic.message.includes("body"))).toBe(true);
    }
  });

  test("reports YAML syntax locations when the parser can provide them", () => {
    const result = parseWorkflowYaml(`
triggers:
  api: {}
steps:
  - fail:
      message: [unterminated
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.line).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.column).toBeGreaterThan(0);
  });
});
