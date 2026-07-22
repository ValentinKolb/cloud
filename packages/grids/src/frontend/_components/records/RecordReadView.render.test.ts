import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { Field, GridRecord } from "../../../service";
import "../ssr-test-plugin";

const { default: RecordReadView, hasRecordDetailValue } = await import("./RecordReadView");

const field = (overrides: Partial<Field> & Pick<Field, "id" | "name" | "type">): Field => ({
  shortId: overrides.id.slice(0, 5),
  tableId: "table",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const record = (data: Record<string, unknown>): GridRecord =>
  ({
    id: "12345678-abcd-4000-8000-000000000000",
    tableId: "table",
    data,
    version: 2,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as GridRecord;

describe("RecordReadView", () => {
  test("renders a record identity hero and omits empty long-form sections", () => {
    const name = field({ id: "name", name: "Name", type: "text", presentable: true });
    const room = field({ id: "room", name: "Room", type: "text" });
    const notes = field({ id: "notes", name: "Notes", type: "longtext" });

    const html = renderToString(() =>
      createComponent(RecordReadView, {
        baseId: "base",
        tableId: "table",
        tableName: "Locations",
        fields: [name, room, notes],
        record: record({ name: "Studio shelf", room: "Studio", notes: "" }),
      }),
    );

    expect(html).toContain("Record details");
    expect(html).toContain("ti-table-row");
    expect(html).toContain("Studio shelf");
    expect(html).toContain('title="Studio shelf"');
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("Fields");
    expect(html).toContain("Room");
    expect(html).not.toContain(">Notes<");
  });

  test("treats only missing and empty string values as absent", () => {
    expect(hasRecordDetailValue(null)).toBe(false);
    expect(hasRecordDetailValue(undefined)).toBe(false);
    expect(hasRecordDetailValue("")).toBe(false);
    expect(hasRecordDetailValue(0)).toBe(true);
    expect(hasRecordDetailValue(false)).toBe(true);
    expect(hasRecordDetailValue([])).toBe(true);
  });
});
