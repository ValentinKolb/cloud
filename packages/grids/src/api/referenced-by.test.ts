import { describe, expect, test } from "bun:test";
import { toPublicReferencedByPage } from "./referenced-by";

describe("referenced-by public DTO", () => {
  test("projects only public record, table, and field IDs", () => {
    const page = toPublicReferencedByPage({
      items: [
        {
          sourceTableId: "11111111-1111-4111-8111-111111111111",
          sourceTableShortId: "TABLE1",
          sourceTableName: "Orders",
          sourceRecordId: "22222222-2222-4222-8222-222222222222",
          sourceRecordShortId: "REC001",
          sourceRecordLabel: "Order 1",
          relationFieldId: "33333333-3333-4333-8333-333333333333",
          relationFieldShortId: "FIELD1",
          relationFieldName: "Customer",
        },
      ],
      nextCursor: "opaque",
    });

    expect(page).toEqual({
      items: [
        {
          sourceTableId: "TABLE1",
          sourceTableName: "Orders",
          sourceRecordId: "REC001",
          sourceRecordLabel: "Order 1",
          relationFieldId: "FIELD1",
          relationFieldName: "Customer",
        },
      ],
      nextCursor: "opaque",
    });
    expect(JSON.stringify(page)).not.toContain("11111111-1111-4111-8111-111111111111");
  });
});
