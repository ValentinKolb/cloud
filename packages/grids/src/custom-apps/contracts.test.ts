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
    const requests = column.blocks[1];
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
                  blocks: [column.blocks[0], { ...requests, rowNavigate: { ...requests.rowNavigate, params: {} } }],
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
});
