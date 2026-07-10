import { describe, expect, test } from "bun:test";
import type { RecordSnapshot } from "../../../contracts";
import {
  type SnapshotRecordNode,
  snapshotFields,
  snapshotGridRecord,
  snapshotRelationLabels,
  snapshotTableName,
} from "./record-snapshot-model";

const snapshot = (root: Record<string, unknown>, graph: Record<string, unknown> = {}): RecordSnapshot => ({
  id: "00000000-0000-4000-8000-000000000001",
  baseId: "00000000-0000-4000-8000-000000000002",
  tableId: "00000000-0000-4000-8000-000000000003",
  recordId: "00000000-0000-4000-8000-000000000004",
  root,
  graph,
  createdBy: null,
  createdAt: "2026-07-11T00:00:00.000Z",
});

describe("record snapshot model", () => {
  test("normalizes stored fields and ignores malformed entries", () => {
    const node: SnapshotRecordNode = {
      fields: [
        { id: "name-field", name: "Name", type: "text", presentable: true, config: { maxLength: 50 } },
        { id: "missing-name", type: "text" },
      ],
    };

    expect(snapshotFields(node, "table")).toMatchObject([
      { id: "name-field", shortId: "name-", tableId: "table", name: "Name", type: "text", presentable: true },
    ]);
  });

  test("builds a stable read-only record with snapshot fallbacks", () => {
    const result = snapshotGridRecord(snapshot({ data: { amount: 12 } }));

    expect(result).toMatchObject({
      id: "00000000-0000-4000-8000-000000000004",
      version: 0,
      data: { amount: 12 },
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
  });

  test("uses stored table names and derives relation labels from presentable fields", () => {
    const relatedId = "00000000-0000-4000-8000-000000000005";
    const value = snapshot(
      { table: { name: "Orders" } },
      {
        records: {
          [relatedId]: {
            id: relatedId,
            table: { id: "customers" },
            fields: [{ id: "display", name: "Name", type: "text", presentable: true }],
            data: { display: "Ada Lovelace" },
          },
        },
      },
    );

    expect(snapshotTableName(value)).toBe("Orders");
    expect(snapshotRelationLabels(value)).toEqual({ [relatedId]: "Ada Lovelace" });
  });
});
