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
  test("accepts the strict one-page Markdown and saved-View Records slice", () => {
    expect(CustomAppDefinitionSchema.safeParse(definition()).success).toBe(true);
    expect(CustomAppDefinitionSchema.safeParse(CUSTOM_APP_REFERENCE.example).success).toBe(true);
  });

  test("rejects unknown keys instead of silently accepting future behavior", () => {
    expect(CustomAppDefinitionSchema.safeParse({ ...definition(), script: "alert(1)" }).success).toBe(false);
  });

  test("rejects multiple pages, invalid spans, and duplicate block ids", () => {
    const multiplePages = definition();
    multiplePages.pages.push({ ...multiplePages.pages[0]!, id: "other", title: "Other" });
    expect(CustomAppDefinitionSchema.safeParse(multiplePages).success).toBe(false);

    const invalidSpan = definition();
    invalidSpan.pages[0]!.rows[0]!.columns[1]!.span = 9;
    expect(CustomAppDefinitionSchema.safeParse(invalidSpan).success).toBe(false);

    const duplicate = definition();
    duplicate.pages[0]!.rows[0]!.columns[1]!.blocks[0]!.id = "welcome";
    expect(CustomAppDefinitionSchema.safeParse(duplicate).success).toBe(false);
  });

  test("rejects ambiguous field projections and unsafe icon values", () => {
    const duplicateField = definition();
    const records = duplicateField.pages[0]!.rows[0]!.columns[1]!.blocks[0]!;
    if ("display" in records) records.display.columnIds.push(records.display.columnIds[0]!);
    expect(CustomAppDefinitionSchema.safeParse(duplicateField).success).toBe(false);
    expect(CustomAppDefinitionSchema.safeParse({ ...definition(), icon: "app-window text-danger" }).success).toBe(false);
  });
});
