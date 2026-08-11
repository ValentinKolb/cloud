import { describe, expect, test } from "bun:test";
import type { Field } from "../contracts";
import { customAppRecordRelationSnapshot, sameCustomAppRecordRelationSnapshot } from "./custom-app-record-relations";
import { selectRelationLabelFields } from "./relation-targets";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const field = (input: Partial<Field> & Pick<Field, "id" | "tableId" | "type">): Field => ({
  id: input.id,
  shortId: "FIELD",
  tableId: input.tableId,
  name: input.name ?? input.id,
  description: null,
  icon: null,
  type: input.type,
  config: input.config ?? {},
  position: input.position ?? 0,
  required: false,
  presentable: input.presentable ?? false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: input.deletedAt ?? null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
});

describe("Grids App Record relation capability", () => {
  test("pins each selected relation target and the exact presentable label fields", () => {
    const sourceTableId = uuid(1);
    const targetTableId = uuid(2);
    const relation = field({ id: uuid(3), tableId: sourceTableId, type: "relation", config: { targetTableId } });
    const fallback = field({ id: uuid(4), tableId: targetTableId, type: "text", position: 0 });
    const second = field({ id: uuid(5), tableId: targetTableId, type: "text", position: 2, presentable: true });
    const first = field({ id: uuid(6), tableId: targetTableId, type: "number", position: 1, presentable: true });

    expect(customAppRecordRelationSnapshot([relation], new Map([[targetTableId, [fallback, second, first]]]))).toEqual([
      { fieldId: relation.id, targetTableId, labelFieldIds: [first.id, second.id] },
    ]);
  });

  test("detects relation target and presentable-field drift", () => {
    const sourceTableId = uuid(10);
    const targetTableId = uuid(11);
    const relation = field({ id: uuid(12), tableId: sourceTableId, type: "relation", config: { targetTableId } });
    const label = field({ id: uuid(13), tableId: targetTableId, type: "text" });
    const published = customAppRecordRelationSnapshot([relation], new Map([[targetTableId, [label]]]));

    expect(sameCustomAppRecordRelationSnapshot(published, published)).toBe(true);
    expect(sameCustomAppRecordRelationSnapshot(published, [{ ...published[0]!, targetTableId: uuid(14) }])).toBe(false);
    expect(sameCustomAppRecordRelationSnapshot(published, [{ ...published[0]!, labelFieldIds: [uuid(15)] }])).toBe(false);
  });

  test("loads only pinned label fields after the live snapshot matched", () => {
    const tableId = uuid(20);
    const published = field({ id: uuid(21), tableId, type: "text", position: 0, presentable: true });
    const addedLater = field({ id: uuid(22), tableId, type: "text", position: 1, presentable: true });

    expect(selectRelationLabelFields([published, addedLater], [published.id]).map((item) => item.id)).toEqual([published.id]);
    expect(selectRelationLabelFields([published, addedLater], []).map((item) => item.id)).toEqual([]);
  });
});
