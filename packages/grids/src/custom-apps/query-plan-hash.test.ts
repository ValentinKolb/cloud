import { describe, expect, test } from "bun:test";
import type { DslResolvedSqlQueryPlan } from "../query-dsl/resolver";
import type { Field } from "../service/types";
import { customAppQueryPlanHash } from "./query-plan-hash";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const sourceTableId = uuid(1);
const targetTableId = uuid(2);
const relationFieldId = uuid(3);
const labelFieldId = uuid(4);

const field = (input: Pick<Field, "id" | "tableId" | "name" | "type"> & Partial<Field>): Field => ({
  shortId: input.id.slice(-5),
  description: null,
  config: {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:00:00.000Z",
  ...input,
});

const plan = (): DslResolvedSqlQueryPlan => ({
  source: { kind: "table", id: sourceTableId, shortId: "SOURCE", name: "Source" },
  tableId: sourceTableId,
  query: { columns: [{ fieldId: relationFieldId }] },
  readableTableIds: [sourceTableId, targetTableId],
  outputColumns: [{ kind: "field", fieldId: relationFieldId }],
});

const fields = (overrides: { relationTargetId?: string; labelFieldId?: string } = {}): Record<string, Field[]> => ({
  [sourceTableId]: [
    field({
      id: relationFieldId,
      tableId: sourceTableId,
      name: "Category",
      type: "relation",
      config: { targetTableId: overrides.relationTargetId ?? targetTableId },
    }),
  ],
  [targetTableId]: [
    field({
      id: overrides.labelFieldId ?? labelFieldId,
      tableId: targetTableId,
      name: "Name",
      type: "text",
      presentable: true,
    }),
  ],
});

describe("Grids App query plan capabilities", () => {
  test("hashes a resolved plan deterministically", () => {
    expect(customAppQueryPlanHash(plan(), fields())).toBe(customAppQueryPlanHash(structuredClone(plan()), structuredClone(fields())));
  });

  test("changes when a resolved field, relation target, or relation label field drifts", () => {
    const initial = customAppQueryPlanHash(plan(), fields());
    const recreatedPlan = plan();
    recreatedPlan.query.columns = [{ fieldId: uuid(30) }];
    recreatedPlan.outputColumns = [{ kind: "field", fieldId: uuid(30) }];

    expect(customAppQueryPlanHash(recreatedPlan, fields())).not.toBe(initial);
    expect(customAppQueryPlanHash(plan(), fields({ relationTargetId: uuid(20) }))).not.toBe(initial);
    expect(customAppQueryPlanHash(plan(), fields({ labelFieldId: uuid(40) }))).not.toBe(initial);
  });
});
