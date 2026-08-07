import { describe, expect, test } from "bun:test";
import type { GridRecord } from "../contracts";
import type { CustomAppCondition, CustomAppPage } from "./contracts";
import { customAppPageRecordFieldIds, matchesCustomAppConditions, visibleCustomAppPage } from "./conditions";

const fieldId = "11111111-1111-4111-8111-111111111111";
const record: GridRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  tableId: "33333333-3333-4333-8333-333333333333",
  data: { [fieldId]: "Submitted" },
  version: 1,
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};

describe("Custom App conditions", () => {
  test("evaluates the bounded AND-list operators", () => {
    const conditions: CustomAppCondition[] = [
      {
        left: { source: "RECORD", path: `fields.${fieldId}` },
        operator: "in",
        right: { source: "LITERAL", value: ["Submitted", "In review"] },
      },
      { left: { source: "PARAMS", path: "request_id" }, operator: "isNotEmpty" },
    ];
    expect(matchesCustomAppConditions(conditions, { params: { request_id: record.id }, record })).toBe(true);
    expect(matchesCustomAppConditions(conditions, { params: {}, record })).toBe(false);
    expect(
      matchesCustomAppConditions(
        [
          {
            left: { source: "PARAMS", path: "missing" },
            operator: "notEq",
            right: { source: "LITERAL", value: "Submitted" },
          },
        ],
        { params: {}, record },
      ),
    ).toBe(false);
  });

  test("collects condition fields and removes hidden blocks and actions", () => {
    const page = {
      id: "request",
      title: "Request",
      navigation: { visible: false, order: 0 },
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
                {
                  id: "actions",
                  type: "actions",
                  actions: [
                    {
                      id: "approve",
                      label: "Approve",
                      kind: "navigate",
                      pageId: "request",
                      history: "push",
                      params: { request_id: { source: "RECORD", path: "id" } },
                      visibleWhen: [
                        {
                          left: { source: "RECORD", path: `fields.${fieldId}` },
                          operator: "eq",
                          right: { source: "LITERAL", value: "Submitted" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as CustomAppPage;
    expect(customAppPageRecordFieldIds(page)).toEqual([fieldId]);
    expect(visibleCustomAppPage(page, { params: { request_id: record.id }, record }).rows[0]?.columns[0]?.blocks).toHaveLength(2);
    expect(
      visibleCustomAppPage(page, { params: { request_id: record.id }, record: { ...record, data: {} } }).rows[0]?.columns[0]?.blocks,
    ).toHaveLength(1);
  });
});
