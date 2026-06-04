import { describe, expect, test } from "bun:test";
import type { Field } from "../../../service";
import { buildFormSubmitPayload } from "./form-submit-payload";

const relationField = (id: string): Field =>
  ({
    id,
    tableId: "00000000-0000-0000-0000-000000000001",
    shortId: "rel01",
    name: "relation",
    type: "relation",
    description: null,
    icon: null,
    config: { targetTableId: "00000000-0000-0000-0000-000000000002", cardinality: "multiple" },
    required: false,
    presentable: false,
    hideInTable: false,
    defaultValue: null,
    indexed: false,
    uniqueConstraint: false,
    position: 0,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as Field;

describe("buildFormSubmitPayload", () => {
  test("drops empty inline drafts and their temp relation ids", () => {
    const fieldId = "00000000-0000-0000-0000-000000000003";

    expect(
      buildFormSubmitPayload(
        [relationField(fieldId)],
        { [fieldId]: ["existing-id", "tmp_empty", "tmp_filled"] },
        {
          [fieldId]: [
            { tempId: "tmp_empty", data: {} },
            { tempId: "tmp_filled", data: { name: "New target" } },
          ],
        },
      ),
    ).toEqual({
      data: { [fieldId]: ["existing-id", "tmp_filled"] },
      inlineCreates: { [fieldId]: [{ tempId: "tmp_filled", data: { name: "New target" } }] },
    });
  });
});
