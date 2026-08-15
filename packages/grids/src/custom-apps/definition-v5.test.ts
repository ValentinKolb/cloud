import { expect, test } from "bun:test";
import { type CustomAppDefinitionResourceKind, migrateCustomAppDefinitionV4 } from "./definition-v5";

test("migrates only typed Custom App resource references to schemaVersion 5", () => {
  const ids = new Map<string, string>([
    ["app:app-uuid", "APP001"],
    ["base:base-uuid", "BASE01"],
    ["table:table-uuid", "TABLE1"],
    ["field:field-uuid", "FIELD1"],
    ["view:view-uuid", "VIEW01"],
    ["launcher:launcher-uuid", "FLOW01"],
  ]);
  const result = migrateCustomAppDefinitionV4(
    {
      schemaVersion: 4,
      kind: "grids.custom-app",
      id: "app-uuid",
      baseId: "base-uuid",
      name: "Requests",
      startPageId: "home",
      pages: [
        {
          id: "home",
          title: "Requests",
          parameters: { request_id: { type: "record", tableId: "table-uuid", required: true } },
          record: { tableId: "table-uuid", id: { source: "PARAMS", path: "request_id" } },
          rows: [
            {
              id: "row",
              columns: [
                {
                  id: "column",
                  span: 12,
                  blocks: [
                    {
                      id: "records",
                      type: "records",
                      source: { kind: "view", viewId: "view-uuid" },
                      display: { kind: "table", columnIds: ["field-uuid"] },
                      rowActions: [{ id: "approve", label: "Approve", kind: "workflow", launcherId: "launcher-uuid" }],
                      searchable: true,
                      pageSize: 25,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      opaqueLiteral: "app-uuid",
    },
    {
      resolve: (kind: CustomAppDefinitionResourceKind, legacyId: string) => ids.get(`${kind}:${legacyId}`) ?? null,
    },
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Strict schema must reject the unrelated opaque key");
  expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("opaqueLiteral"))).toBe(true);
});

test("returns a strict v5 definition and delegates embedded GQL canonicalization", () => {
  const result = migrateCustomAppDefinitionV4(
    {
      schemaVersion: 4,
      kind: "grids.custom-app",
      id: "old-app",
      baseId: "old-base",
      name: "Overview",
      startPageId: "home",
      pages: [
        {
          id: "home",
          title: "Home",
          rows: [
            {
              id: "row",
              columns: [
                {
                  id: "column",
                  span: 12,
                  blocks: [
                    {
                      id: "records",
                      type: "records",
                      source: { kind: "gql", query: "old gql" },
                      display: { kind: "table", columnIds: [] },
                      emptyText: "Nothing here",
                      rowActions: [
                        {
                          id: "approve-row",
                          label: "Approve row",
                          kind: "workflow",
                          launcherId: "old-launcher",
                          availableWhen: { query: "old row availability" },
                        },
                      ],
                    },
                    {
                      id: "actions",
                      type: "actions",
                      actions: [
                        {
                          id: "approve",
                          label: "Approve",
                          kind: "workflow",
                          launcherId: "old-launcher",
                          availableWhen: { query: "old action availability" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "detail",
          title: "Detail",
          navigation: { visible: false },
          parameters: { record_id: { type: "record", tableId: "old-table", required: true } },
          record: { tableId: "old-table", id: { source: "PARAMS", path: "record_id" } },
          rows: [
            {
              id: "detail-row",
              columns: [
                {
                  id: "detail-column",
                  span: 12,
                  blocks: [
                    { id: "record", type: "record", fieldIds: ["old-field"], editableFieldIds: [] },
                    { id: "comments", type: "comments", emptyText: "No comments" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      resolve: (kind) =>
        kind === "app"
          ? "APP001"
          : kind === "base"
            ? "BASE01"
            : kind === "table"
              ? "TABLE1"
              : kind === "field"
                ? "FIELD1"
                : kind === "launcher"
                  ? "FLOW01"
                  : null,
      migrateGql: (source) => `canonical:${source}`,
    },
  );

  expect(result).toMatchObject({ ok: true, definition: { schemaVersion: 5, id: "APP001", baseId: "BASE01" } });
  if (result.ok) {
    const block = result.definition.pages[0]!.rows[0]!.columns[0]!.blocks[0]!;
    expect(block.type === "records" && block.source.kind === "gql" ? block.source.query : null).toBe("canonical:old gql");
    expect(block.type === "records" ? block.rowActions?.[0]?.availableWhen?.query : null).toBe("canonical:old row availability");
    expect(block.type === "records" ? block.emptyText : null).toBe("Nothing here");
    const actions = result.definition.pages[0]!.rows[0]!.columns[0]!.blocks[1]!;
    expect(actions.type === "actions" ? actions.actions[0]?.availableWhen?.query : null).toBe("canonical:old action availability");
    const comments = result.definition.pages[1]!.rows[0]!.columns[0]!.blocks[1]!;
    expect(comments.type).toBe("comments");
    expect("emptyText" in comments).toBe(false);
  }
});
