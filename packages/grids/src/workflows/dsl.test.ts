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
      equals:
        - "\${{ inputs.item.Status }}"
        - Loaned
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: Available
            Last scanned at: \${{ now() }}
      - createRecord:
          table: Movements
          values:
            Item: \${{ inputs.item }}
            Type: Check-in
            Timestamp: \${{ now() }}
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

  test("parses succeed steps for human workflow messages", () => {
    const result = parseWorkflowYaml(`
triggers:
  api: {}
steps:
  - succeed:
      message: Item returned.
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.steps[0]).toEqual({ succeed: { message: "Item returned." } });
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

  test("rejects unknown input references in workflow values", () => {
    const result = parseWorkflowYaml(`
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
        record: \${{ inputs.missing.Name }}
        literal: example.com.value
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      'steps.0.httpRequest.json.record: references unknown input "missing"',
    );
  });

  test("keeps every plain string literal", () => {
    const literal = parseWorkflowYaml(`
triggers:
  api: {}
steps:
  - httpRequest:
      url: https://example.com/hook
      json:
        email: person@example.com
        dotted: example.com.value
        referenceLike: inputs.item.Name
        functionLike: now()
`);
    expect(literal.ok).toBe(true);
  });

  test("validates sequential saved values and setVariable kinds", () => {
    const result = parseWorkflowYaml(`
triggers:
  api: {}
steps:
  - createRecord:
      table: Items
      values:
        Name: Created
      saveAs: created
  - setVariable:
      name: selected
      value: "\${{ created }}"
  - updateRecord:
      record: selected
      set:
        Name: Updated
`);
    expect(result.ok).toBe(true);
  });

  test("validates known structured output paths", () => {
    const valid = parseWorkflowYaml(`
inputs:
  item:
    type: record
    table: Items
triggers:
  api: {}
steps:
  - generateDocument:
      template: Label
      record: inputs.item
      saveAs: pdf
  - createDocumentLink:
      document: pdf
      saveAs: link
  - httpRequest:
      url: https://example.com/hook
      saveAs: hook
  - setVariable:
      name: filename
      value: "\${{ pdf.filename }}"
  - setVariable:
      name: publicUrl
      value: "\${{ link.url }}"
  - setVariable:
      name: status
      value: "\${{ hook.status }}"
`);
    expect(valid.ok).toBe(true);

    const invalid = parseWorkflowYaml(`
inputs:
  item:
    type: record
    table: Items
triggers:
  api: {}
steps:
  - generateDocument:
      template: Label
      record: inputs.item
      saveAs: pdf
  - setVariable:
      name: invalid
      value: "\${{ pdf.unknown }}"
`);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
        'steps.1.setVariable.value: unknown document value path "unknown"',
      );
    }
  });

  test("rejects forward, duplicate, and escaped control-flow values", () => {
    const result = parseWorkflowYaml(`
triggers:
  api: {}
steps:
  - setVariable:
      name: forward
      value: "\${{ later }}"
  - setVariable:
      name: duplicate
      value: first
  - setVariable:
      name: duplicate
      value: second
  - if:
      equals: [true, true]
    then:
      - setVariable:
          name: branchOnly
          value: yes
  - setVariable:
      name: escaped
      value: "\${{ branchOnly }}"
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        'steps.0.setVariable.value: references unknown value "later"',
        'steps.2: value name "duplicate" is already defined',
        'steps.4.setVariable.value: references unknown value "branchOnly"',
      ]),
    );
  });

  test("keeps loop aliases local and validates message expressions", () => {
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
      - succeed:
          message: "Processed \${{ item.Name }} at \${{ now() }}"
  - setVariable:
      name: leaked
      value: "\${{ item }}"
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      'steps.1.setVariable.value: references unknown value "item"',
    );
  });

  test("does not treat a record field expression as a record reference", () => {
    const result = parseWorkflowYaml(`
inputs:
  item:
    type: record
    table: Items
triggers:
  api: {}
steps:
  - setVariable:
      name: scalar
      value: "\${{ inputs.item.Name }}"
  - updateRecord:
      record: scalar
      set:
        Status: done
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      "steps.1.updateRecord.record: record references value, expected record",
    );
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

  test("rejects triggers that cannot provide required inputs", () => {
    const schedule = parseWorkflowYaml(`
inputs:
  item:
    type: record
    table: Items
    required: true
triggers:
  schedule:
    cron: "0 8 * * *"
steps:
  - fail:
      message: stop
`);

    expect(schedule.ok).toBe(false);
    if (!schedule.ok)
      expect(schedule.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
        'triggers.schedule: required input "item" cannot be provided by this trigger',
      );

    const scanner = parseWorkflowYaml(`
inputs:
  item:
    type: record
    table: Items
    required: true
  note:
    type: text
    required: true
triggers:
  scanner:
    input: item
steps:
  - succeed:
      message: ok
`);

    expect(scanner.ok).toBe(false);
    if (!scanner.ok)
      expect(scanner.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
        'triggers.scanner: required input "note" cannot be provided by this trigger',
      );

    const api = parseWorkflowYaml(`
inputs:
  item:
    type: record
    table: Items
    required: true
  note:
    type: text
    required: true
triggers:
  api: {}
steps:
  - succeed:
      message: ok
`);

    expect(api.ok).toBe(true);
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
