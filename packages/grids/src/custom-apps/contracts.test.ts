import { describe, expect, test } from "bun:test";
import { CUSTOM_APP_REFERENCE, CustomAppDefinitionSchema } from "./contracts";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const definition = () => ({
  schemaVersion: 1,
  kind: "grids.custom-app",
  id: uuid(1),
  baseId: uuid(2),
  name: "Certificate requests",
  startPageId: "home",
  pages: [
    {
      id: "home",
      title: "Requests",
      rows: [
        {
          id: "intro",
          columns: [
            { id: "copy", span: 4, blocks: [{ id: "welcome", type: "markdown", markdown: "# Welcome" }] },
            {
              id: "records",
              span: 8,
              blocks: [
                {
                  id: "requests",
                  type: "records",
                  source: { kind: "view", viewId: uuid(3) },
                  display: { kind: "table", columnIds: [uuid(4)] },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("Custom App definition contract", () => {
  test("accepts strict multi-page list and route-only record detail definitions", () => {
    expect(CustomAppDefinitionSchema.safeParse(definition()).success).toBe(true);
    expect(CustomAppDefinitionSchema.safeParse(CUSTOM_APP_REFERENCE.example).success).toBe(true);
  });

  test("keeps the live Help YAML aligned with the public schema", async () => {
    const markdown = await Bun.file(new URL("../help/documents/grids-custom-apps.help.md", import.meta.url)).text();
    const source = markdown.match(/```yaml\n([\s\S]*?)```/)?.[1];
    expect(source).toBeDefined();
    expect(CustomAppDefinitionSchema.safeParse(Bun.YAML.parse(source!)).success).toBe(true);
  });

  test("accepts the parameter-only article entry fixture", async () => {
    const source = await Bun.file(new URL("../../docs/custom-apps/article-entry.yaml", import.meta.url)).text();
    const parsed = CustomAppDefinitionSchema.safeParse(Bun.YAML.parse(source));
    expect(parsed.success).toBe(true);
  });

  test("rejects unknown keys instead of silently accepting future behavior", () => {
    expect(CustomAppDefinitionSchema.safeParse({ ...definition(), script: "alert(1)" }).success).toBe(false);
  });

  test("rejects invalid spans and duplicate page or block ids", () => {
    const invalidSpan = definition();
    invalidSpan.pages[0]!.rows[0]!.columns[1]!.span = 9;
    expect(CustomAppDefinitionSchema.safeParse(invalidSpan).success).toBe(false);

    const duplicate = definition();
    duplicate.pages[0]!.rows[0]!.columns[1]!.blocks[0]!.id = "welcome";
    expect(CustomAppDefinitionSchema.safeParse(duplicate).success).toBe(false);

    const duplicatePage = definition();
    duplicatePage.pages.push({ ...duplicatePage.pages[0]!, title: "Other" });
    expect(CustomAppDefinitionSchema.safeParse(duplicatePage).success).toBe(false);
  });

  test("rejects ambiguous field projections and unsafe icon values", () => {
    const duplicateField = definition();
    const records = duplicateField.pages[0]!.rows[0]!.columns[1]!.blocks[0]!;
    if ("display" in records) records.display.columnIds.push(records.display.columnIds[0]!);
    expect(CustomAppDefinitionSchema.safeParse(duplicateField).success).toBe(false);
    expect(CustomAppDefinitionSchema.safeParse({ ...definition(), icon: "app-window text-danger" }).success).toBe(false);
  });

  test("requires editable Record fields to be part of the displayed allowlist", () => {
    const example = CustomAppDefinitionSchema.parse(structuredClone(CUSTOM_APP_REFERENCE.example));
    const detail = example.pages.find((page) => page.record)!;
    const record = detail.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks)).find((block) => block.type === "record")!;
    if (record.type !== "record") throw new Error("Expected Record block");
    record.editableFieldIds = [record.fieldIds[0]!];
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(true);
    record.editableFieldIds = [record.fieldIds[0]!, record.fieldIds[0]!];
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(false);
    record.editableFieldIds = [uuid(99)];
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(false);
  });

  test("accepts an exact Record document template allowlist and rejects duplicates", () => {
    const example = CustomAppDefinitionSchema.parse(structuredClone(CUSTOM_APP_REFERENCE.example));
    const detail = example.pages.find((page) => page.record)!;
    const record = detail.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks)).find((block) => block.type === "record")!;
    if (record.type !== "record") throw new Error("Expected Record block");
    expect(record.documents?.templateIds).toHaveLength(1);
    record.documents = { templateIds: [uuid(70), uuid(70)] };
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(false);
  });

  test("accepts bounded presentation conditions and rejects unavailable values", () => {
    const example = CustomAppDefinitionSchema.parse(structuredClone(CUSTOM_APP_REFERENCE.example));
    const detail = example.pages[1]!;
    const recordBlock = detail.rows[0]!.columns[0]!.blocks.find((block) => block.type === "record")!;
    recordBlock.visibleWhen = [
      {
        left: { source: "RECORD", path: `fields.${recordBlock.fieldIds[0]}` },
        operator: "isNotEmpty",
      },
    ];
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(true);
    recordBlock.visibleWhen = [
      {
        left: { source: "RECORD", path: `fields.${Bun.randomUUIDv7()}` },
        operator: "isNotEmpty",
      },
    ];
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(true);

    const missingParam = CustomAppDefinitionSchema.parse(structuredClone(example));
    missingParam.pages[1]!.rows[0]!.columns[0]!.blocks[0]!.visibleWhen = [
      { left: { source: "PARAMS", path: "missing" }, operator: "isNotEmpty" },
    ];
    expect(CustomAppDefinitionSchema.safeParse(missingParam).success).toBe(false);

    const missingRecord = CustomAppDefinitionSchema.parse(structuredClone(example));
    missingRecord.pages[0]!.rows[0]!.columns[0]!.blocks[0]!.visibleWhen = [
      { left: { source: "RECORD", path: `fields.${recordBlock.fieldIds[0]}` }, operator: "isNotEmpty" },
    ];
    expect(CustomAppDefinitionSchema.safeParse(missingRecord).success).toBe(false);
  });

  test("rejects unbound, visible, or mismatched record pages and incomplete row navigation", () => {
    const example = CUSTOM_APP_REFERENCE.example;
    const detail = example.pages[1];

    const visible = {
      ...example,
      pages: [example.pages[0], { ...detail, navigation: { ...detail.navigation, visible: true } }],
    };
    expect(CustomAppDefinitionSchema.safeParse(visible).success).toBe(false);

    const mismatched = {
      ...example,
      pages: [example.pages[0], { ...detail, record: { ...detail.record, tableId: uuid(99) } }],
    };
    expect(CustomAppDefinitionSchema.safeParse(mismatched).success).toBe(false);

    const { record: _record, ...detailWithoutRecord } = detail;
    const unbound = { ...example, pages: [example.pages[0], detailWithoutRecord] };
    expect(CustomAppDefinitionSchema.safeParse(unbound).success).toBe(false);

    const recordWithoutBlock = {
      ...example,
      pages: [
        example.pages[0],
        {
          ...detail,
          rows: [
            {
              ...detail.rows[0],
              columns: [{ ...detail.rows[0].columns[0], blocks: [{ id: "copy", type: "markdown", markdown: "Hello" }] }],
            },
          ],
        },
      ],
    };
    expect(CustomAppDefinitionSchema.safeParse(recordWithoutBlock).success).toBe(false);

    const home = example.pages[0];
    const column = home.rows[0].columns[0];
    const requests = column.blocks.find((block) => block.type === "records")!;
    const missingParam = {
      ...example,
      pages: [
        {
          ...home,
          rows: [
            {
              ...home.rows[0],
              columns: [
                {
                  ...column,
                  blocks: column.blocks.map((block) =>
                    block.id === requests.id ? { ...requests, rowNavigate: { ...requests.rowNavigate, params: {} } } : block,
                  ),
                },
              ],
            },
          ],
        },
        detail,
      ],
    };
    expect(CustomAppDefinitionSchema.safeParse(missingParam).success).toBe(false);
    expect(detail.parameters.request_id.type).toBe("record");
  });

  test("accepts Form create-to-detail navigation and rejects undeclared parameter bindings", () => {
    const example = CustomAppDefinitionSchema.parse(structuredClone(CUSTOM_APP_REFERENCE.example));
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(true);

    const invalid = CustomAppDefinitionSchema.parse(structuredClone(example));
    const form = invalid.pages[0]!.rows[0]!.columns[0]!.blocks.find((block) => block.type === "form")!;
    if (form.type !== "form") throw new Error("Expected Form block");
    form.fixedValues[uuid(21)] = { source: "PARAMS", path: "missing" };
    expect(CustomAppDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  test("requires Comments blocks to inherit one declared page record", () => {
    const source = definition();
    const page = source.pages[0]!;
    const row = page.rows[0]!;
    const column = row.columns[0]!;
    const withoutRecord = {
      ...source,
      pages: [
        { ...page, rows: [{ ...row, columns: [{ ...column, blocks: [...column.blocks, { id: "discussion", type: "comments" }] }] }] },
      ],
    };
    expect(CustomAppDefinitionSchema.safeParse(withoutRecord).success).toBe(false);

    const example = CustomAppDefinitionSchema.parse(structuredClone(CUSTOM_APP_REFERENCE.example));
    const detail = example.pages.find((page) => page.record);
    expect(detail?.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks)).some((block) => block.type === "comments")).toBe(
      true,
    );
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(true);
  });

  test("accepts typed navigation and workflow actions and rejects ambiguous bindings", () => {
    const example = CustomAppDefinitionSchema.parse(structuredClone(CUSTOM_APP_REFERENCE.example));
    const detail = example.pages[1]!;
    detail.rows[0]!.columns[0]!.blocks.push({
      id: "actions",
      type: "actions",
      actions: [
        {
          id: "reload-detail",
          label: "Open request",
          kind: "navigate",
          pageId: "request",
          history: "replace",
          params: { request_id: { source: "RECORD", path: "id" } },
        },
        {
          id: "approve",
          label: "Approve",
          kind: "workflow",
          launcherId: uuid(90),
          inputs: {
            request: { source: "RECORD", path: "id" },
            reason: { source: "LITERAL", value: "approved" },
          },
          confirm: "Approve this request?",
        },
      ],
    });
    expect(CustomAppDefinitionSchema.safeParse(example).success).toBe(true);

    const duplicateAction = structuredClone(example);
    const duplicateBlock = duplicateAction.pages[1]!.rows[0]!.columns[0]!.blocks.at(-1)!;
    if (duplicateBlock.type !== "actions") throw new Error("Expected Actions block");
    duplicateBlock.actions[1]!.id = duplicateBlock.actions[0]!.id;
    expect(CustomAppDefinitionSchema.safeParse(duplicateAction).success).toBe(false);

    const missingRecord = structuredClone(example);
    delete missingRecord.pages[1]!.record;
    expect(CustomAppDefinitionSchema.safeParse(missingRecord).success).toBe(false);
  });

  test("accepts bounded Metrics and Chart sources", () => {
    const source = definition();
    source.pages[0]!.rows[0]!.columns[0]!.blocks.push(
      {
        id: "totals",
        type: "metrics",
        source: { kind: "gql", query: 'from table "Requests"\naggregate count(*) as requests', maxRows: 1 },
      } as never,
      {
        id: "requests-by-state",
        type: "chart",
        chartType: "bar",
        source: { kind: "view", viewId: uuid(5) },
        limit: 20,
      } as never,
    );

    const parsed = CustomAppDefinitionSchema.safeParse(source);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const chart = parsed.data.pages[0]!.rows[0]!.columns[0]!.blocks.find((block) => block.type === "chart");
      expect(chart?.limit).toBe(20);
    }
  });

  test("requires inline GQL inputs to use parameters declared by the current page", () => {
    const source = definition();
    source.pages[0]!.rows[0]!.columns[0]!.blocks.push({
      id: "children",
      type: "records",
      source: {
        kind: "gql",
        query: "from table Children\nwhere Parent = param('parent_id')",
        maxRows: 100,
        inputs: { parent_id: { source: "PARAMS", path: "missing" } },
      },
      display: { kind: "table", columnIds: [uuid(20)] },
    } as never);
    expect(CustomAppDefinitionSchema.safeParse(source).success).toBe(false);
  });

  test("rejects unbounded or oversized insight sources", () => {
    const source = definition();
    source.pages[0]!.rows[0]!.columns[0]!.blocks.push({
      id: "totals",
      type: "metrics",
      source: { kind: "gql", query: 'from table "Requests"\naggregate count(*) as requests' },
    } as never);
    expect(CustomAppDefinitionSchema.safeParse(source).success).toBe(false);

    const oversized = definition();
    oversized.pages[0]!.rows[0]!.columns[0]!.blocks.push({
      id: "requests-by-state",
      type: "chart",
      chartType: "line",
      source: { kind: "gql", query: 'from table "Requests"\ngroup by Status\naggregate count(*) as requests', maxRows: 101 },
    } as never);
    expect(CustomAppDefinitionSchema.safeParse(oversized).success).toBe(false);
  });
});
