import { describe, expect, test } from "bun:test";
import type { MailSearchExpression } from "../../contracts";
import {
  appendMailSearchExpression,
  countMailSearchNodes,
  ensureMailSearchRootGroup,
  mailSearchExpressionDepth,
  removeMailSearchExpression,
  summarizeMailSearchExpression,
  toggleMailSearchNegation,
  updateMailSearchExpression,
} from "./mail-search-builder-model";

const root: MailSearchExpression = {
  type: "and",
  expressions: [
    { type: "text", field: "subject", query: "invoice", match: "words" },
    {
      type: "or",
      expressions: [
        { type: "response_needed", value: true },
        { type: "work_status", value: "waiting" },
      ],
    },
  ],
};

describe("Mail search builder model", () => {
  test("updates nested nodes without mutating siblings", () => {
    const updated = updateMailSearchExpression(root, [1, 0], () => ({ type: "response_needed", value: false }));
    expect(updated).not.toBe(root);
    expect(updated).toEqual({
      ...root,
      expressions: [
        root.expressions[0]!,
        {
          type: "or",
          expressions: [
            { type: "response_needed", value: false },
            { type: "work_status", value: "waiting" },
          ],
        },
      ],
    });
    expect(root.expressions[1]).toEqual({
      type: "or",
      expressions: [
        { type: "response_needed", value: true },
        { type: "work_status", value: "waiting" },
      ],
    });
  });

  test("preserves nested paths through NOT wrappers", () => {
    const negated = toggleMailSearchNegation(root, [1]);
    const updated = updateMailSearchExpression(negated, [1, 1], () => ({ type: "work_status", value: "done" }));
    expect(updated).toEqual({
      ...root,
      expressions: [
        root.expressions[0]!,
        {
          type: "not",
          expression: {
            type: "or",
            expressions: [
              { type: "response_needed", value: true },
              { type: "work_status", value: "done" },
            ],
          },
        },
      ],
    });
  });

  test("adds and removes conditions while keeping non-empty groups", () => {
    const appended = appendMailSearchExpression(root, [1], { type: "snoozed", value: true });
    expect(countMailSearchNodes(appended)).toBe(6);
    expect(removeMailSearchExpression(appended, [1, 2])).toEqual(root);

    const single: MailSearchExpression = { type: "and", expressions: [{ type: "response_needed", value: true }] };
    expect(removeMailSearchExpression(single, [0])).toEqual(single);
  });

  test("normalizes leaf roots and produces a readable boolean summary", () => {
    expect(
      ensureMailSearchRootGroup({ type: "not", expression: { type: "text", field: "from", query: "alerts", match: "contains" } }),
    ).toEqual({
      type: "and",
      expressions: [{ type: "not", expression: { type: "text", field: "from", query: "alerts", match: "contains" } }],
    });
    expect(summarizeMailSearchExpression(root)).toBe("(Subject words “invoice”) and ((Response is needed) or (Work status is waiting))");
  });

  test("measures NOT wrappers as search depth and nodes", () => {
    const nested = toggleMailSearchNegation(root, [1]);
    expect(mailSearchExpressionDepth(nested)).toBe(4);
    expect(countMailSearchNodes(nested)).toBe(6);
  });
});
