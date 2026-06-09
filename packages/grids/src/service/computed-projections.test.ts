import { describe, expect, test } from "bun:test";
import { applyComputedProjections, buildFormulaSqlProjections } from "./computed-projections";
import type { Field } from "./types";

const field = (overrides: Partial<Field> & Pick<Field, "id" | "shortId" | "name" | "type">): Field => ({
  id: overrides.id,
  shortId: overrides.shortId,
  tableId: "table_1",
  name: overrides.name,
  description: null,
  icon: null,
  type: overrides.type,
  config: overrides.config ?? {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("buildFormulaSqlProjections", () => {
  test("emits a SQL projection for scalar formula fields", () => {
    const price = field({ id: "price_id", shortId: "price", name: "Price", type: "number" });
    const total = field({
      id: "total_id",
      shortId: "total",
      name: "Total",
      type: "formula",
      config: { expression: "#price * 1.19" },
    });

    const projections = buildFormulaSqlProjections([price, total]);

    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({
      fieldId: "total_id",
      outputType: "decimal",
    });
  });

  test("skips formula fields that need non-SQL projections", () => {
    const relation = field({ id: "relation_id", shortId: "relat", name: "Relation", type: "relation" });
    const formula = field({
      id: "formula_id",
      shortId: "formu",
      name: "Formula",
      type: "formula",
      config: { expression: "#relat" },
    });

    expect(buildFormulaSqlProjections([relation, formula])).toEqual([]);
  });

  test("keeps decimal formula values as strings when merging result rows", () => {
    const formula = field({
      id: "total_id",
      shortId: "total",
      name: "Total",
      type: "formula",
      config: { expression: "0.1 + 0.2" },
    });
    const [projection] = buildFormulaSqlProjections([formula]);
    expect(projection).toBeDefined();

    const record = { data: {} as Record<string, unknown> };
    applyComputedProjections([{ id: "record_1", [projection!.alias]: "0.3" }], new Map([["record_1", record]]), [projection!]);

    expect(record.data.total_id).toBe("0.3");
  });
});
