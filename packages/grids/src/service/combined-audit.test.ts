import { describe, expect, test } from "bun:test";
import { type CombinedAuditProjectionMapping, projectCombinedAuditContext, projectCombinedAuditDiff } from "./combined-audit";
import type { Field } from "./types";

const field = (type: Field["type"]): Field => ({ type }) as Field;

describe("Combined audit projection", () => {
  test("publishes only actively mapped fields under canonical ids", () => {
    const mappings: CombinedAuditProjectionMapping[] = [
      {
        targetFieldId: "target-name",
        targetField: field("text"),
        sourceFieldId: "source-name",
        sourceField: field("text"),
        config: {},
      },
    ];

    expect(
      projectCombinedAuditDiff(
        {
          "source-name": { old: "Before", new: "After" },
          "private-field": { old: "secret", new: "changed" },
        },
        mappings,
      ),
    ).toEqual({
      "target-name": { old: "Before", new: "After" },
    });
  });

  test("translates published select options without exposing unknown source ids", () => {
    const mappings: CombinedAuditProjectionMapping[] = [
      {
        targetFieldId: "target-status",
        targetField: {
          ...field("select"),
          config: { options: [{ id: "target_available", label: "Available" }] },
        },
        sourceFieldId: "source-status",
        sourceField: field("select"),
        config: { optionMap: { source_open: "target_available" } },
      },
    ];

    expect(
      projectCombinedAuditDiff(
        {
          "source-status": { old: "source_open", new: "removed_source_option" },
        },
        mappings,
      ),
    ).toEqual({
      "target-status": {
        old: "Available",
        new: "Unavailable in current Combined mapping",
      },
    });
  });

  test("summarizes relation and file changes without exposing physical ids", () => {
    const mappings: CombinedAuditProjectionMapping[] = [
      {
        targetFieldId: "target-relation",
        targetField: field("relation"),
        sourceFieldId: "source-relation",
        sourceField: field("relation"),
        config: {},
      },
      {
        targetFieldId: "target-files",
        targetField: field("file"),
        sourceFieldId: "source-files",
        sourceField: field("file"),
        config: {},
      },
    ];

    expect(
      projectCombinedAuditDiff(
        {
          "source-relation": {
            old: ["11111111-1111-4111-8111-111111111111"],
            new: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
          },
          "source-files": {
            old: null,
            new: ["33333333-3333-4333-8333-333333333333"],
          },
        },
        mappings,
      ),
    ).toEqual({
      "target-relation": { old: "1 related record", new: "2 related records" },
      "target-files": { old: null, new: "1 file" },
    });
  });

  test("keeps declared answers without exposing source question ids or option catalogs", () => {
    expect(
      projectCombinedAuditContext({
        version: 1,
        operation: "delete",
        questions: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            label: "Deletion reason",
            type: "select",
            required: true,
            options: [{ id: "22222222-2222-4222-8222-222222222222", label: "Retired" }],
          },
        ],
        answers: [
          {
            questionId: "11111111-1111-4111-8111-111111111111",
            label: "Deletion reason",
            type: "select",
            required: true,
            value: "22222222-2222-4222-8222-222222222222",
            optionLabel: "Retired",
          },
        ],
      }),
    ).toEqual({
      operation: "delete",
      answers: [
        {
          label: "Deletion reason",
          type: "select",
          required: true,
          value: "Retired",
          optionLabel: "Retired",
        },
      ],
    });
  });

  test("rejects present but invalid mutation context instead of dropping required answers", () => {
    expect(() =>
      projectCombinedAuditContext({
        version: 1,
        operation: "delete",
        questions: [],
        answers: [{ label: "Deletion reason", value: "Retired" }],
      }),
    ).toThrow("Combined audit history contains invalid mutation context");
  });

  test("rejects select answers without a published label", () => {
    expect(() =>
      projectCombinedAuditContext({
        version: 1,
        operation: "delete",
        questions: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            label: "Deletion reason",
            type: "select",
            required: true,
            options: [{ id: "22222222-2222-4222-8222-222222222222", label: "Retired" }],
          },
        ],
        answers: [
          {
            questionId: "11111111-1111-4111-8111-111111111111",
            label: "Deletion reason",
            type: "select",
            required: true,
            value: "22222222-2222-4222-8222-222222222222",
          },
        ],
      }),
    ).toThrow("Combined audit history contains an unlabeled select answer");
  });
});
