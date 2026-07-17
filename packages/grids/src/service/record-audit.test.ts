import { describe, expect, test } from "bun:test";
import type { TableAuditPolicy } from "../contracts";
import { buildRecordAuditContext } from "./record-audit";

const DELETE_QUESTION = "00000000-0000-4000-8000-000000000101";
const UPDATE_QUESTION = "00000000-0000-4000-8000-000000000102";
const OPTION = "00000000-0000-4000-8000-000000000103";
const TRACKED_FIELD = "00000000-0000-4000-8000-000000000104";
const OTHER_FIELD = "00000000-0000-4000-8000-000000000105";

const policy: TableAuditPolicy = {
  delete: {
    enabled: true,
    questions: [
      {
        id: DELETE_QUESTION,
        label: "Reason",
        type: "select",
        required: true,
        options: [{ id: OPTION, label: "Broken" }],
      },
    ],
  },
  update: {
    enabled: true,
    scope: "selected",
    fieldIds: [TRACKED_FIELD],
    questions: [{ id: UPDATE_QUESTION, label: "Change note", type: "longtext", required: true }],
  },
};

describe("record audit policy enforcement", () => {
  test("rejects missing required answers before a protected operation", () => {
    const result = buildRecordAuditContext(policy, "delete", []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Reason");
  });

  test("stores immutable question and option labels with the accepted value", () => {
    const result = buildRecordAuditContext(policy, "delete", [], { answers: { [DELETE_QUESTION]: OPTION } });
    expect(result).toEqual({
      ok: true,
      data: {
        version: 1,
        operation: "delete",
        questions: policy.delete!.questions,
        answers: [
          {
            questionId: DELETE_QUESTION,
            label: "Reason",
            type: "select",
            required: true,
            value: OPTION,
            optionLabel: "Broken",
          },
        ],
      },
    });
  });

  test("applies update requirements only when a configured field changed", () => {
    expect(buildRecordAuditContext(policy, "update", [OTHER_FIELD])).toEqual({ ok: true, data: null });
    const protectedResult = buildRecordAuditContext(policy, "update", [TRACKED_FIELD]);
    expect(protectedResult.ok).toBe(false);
  });

  test("applies all-field update requirements to every material change", () => {
    const allFieldsPolicy: TableAuditPolicy = {
      update: { ...policy.update!, scope: "all", fieldIds: [] },
    };
    expect(buildRecordAuditContext(allFieldsPolicy, "update", [OTHER_FIELD]).ok).toBe(false);
    expect(buildRecordAuditContext(allFieldsPolicy, "update", [])).toEqual({ ok: true, data: null });
  });

  test("rejects unknown answers instead of silently discarding them", () => {
    const result = buildRecordAuditContext(policy, "delete", [], {
      answers: { [DELETE_QUESTION]: OPTION, [OTHER_FIELD]: "unexpected" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Unknown audit question");
  });

  test("rejects audit metadata when no requirement applies", () => {
    const result = buildRecordAuditContext({}, "restore", [], { answers: { [OTHER_FIELD]: "unexpected" } });
    expect(result.ok).toBe(false);
  });

  test("preserves optional questions even when they are unanswered", () => {
    const optionalPolicy: TableAuditPolicy = {
      restore: {
        enabled: true,
        questions: [{ id: UPDATE_QUESTION, label: "Optional note", type: "text", required: false }],
      },
    };
    const result = buildRecordAuditContext(optionalPolicy, "restore", []);
    expect(result).toEqual({
      ok: true,
      data: {
        version: 1,
        operation: "restore",
        questions: optionalPolicy.restore!.questions,
        answers: [],
      },
    });
  });

  test("validates audit payload limits at the service boundary", () => {
    const result = buildRecordAuditContext(policy, "delete", [], {
      answers: { [DELETE_QUESTION]: "x".repeat(10_001) },
    });
    expect(result.ok).toBe(false);
  });
});
