import { describe, expect, test } from "bun:test";
import { customAppPageRecordFieldIds } from "./conditions";
import type { CustomAppPage } from "./contracts";

const fieldId = "11111111-1111-4111-8111-111111111111";

describe("Grids App page record fields", () => {
  test("collects the explicit Record block allowlist", () => {
    const page = {
      id: "request",
      title: "Request",
      navigation: { visible: false },
      parameters: { request_id: { type: "record", tableId: fieldId, required: true } },
      record: { tableId: fieldId, id: { source: "PARAMS", path: "request_id" } },
      rows: [
        {
          id: "main",
          columns: [
            {
              id: "content",
              span: 12,
              blocks: [
                { id: "record", type: "record", fieldIds: [fieldId], editableFieldIds: [] },
                { id: "duplicate", type: "record", fieldIds: [fieldId], editableFieldIds: [] },
              ],
            },
          ],
        },
      ],
    } as CustomAppPage;

    expect(customAppPageRecordFieldIds(page)).toEqual([fieldId]);
  });
});
