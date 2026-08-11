import { describe, expect, test } from "bun:test";
import { customAppRecordsResultColumns } from "./records-table-model";

const columns = [
  {
    key: "name",
    label: "Name",
    tableId: "11111111-1111-4111-8111-111111111111",
    fieldId: "22222222-2222-4222-8222-222222222222",
    type: "text",
    sqlType: "text",
  },
  { key: "total", label: "Total", type: "number", sqlType: "numeric", aggregate: "count" },
];

describe("Custom App Records columns", () => {
  test("keeps every GQL output column, including aliases without field IDs", () => {
    expect(customAppRecordsResultColumns(columns).map((column) => column.key)).toEqual(["name", "total"]);
  });

  test("filters saved-view output to the explicitly selected fields", async () => {
    expect(customAppRecordsResultColumns(columns, ["22222222-2222-4222-8222-222222222222"]).map((column) => column.key)).toEqual(["name"]);
    expect(customAppRecordsResultColumns(columns, ["33333333-3333-4333-8333-333333333333"])).toEqual([]);
    const source = await Bun.file(new URL("./RecordsTable.island.tsx", import.meta.url)).text();
    expect(source).toContain("<Placeholder");
    expect(source).toContain('state="error"');
    expect(source).not.toContain("rounded-xl border");
  });
});
