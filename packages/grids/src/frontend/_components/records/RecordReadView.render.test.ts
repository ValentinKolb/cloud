import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { Field, GridRecord } from "../../../service";
import "../ssr-test-plugin";

const { default: RecordReadView, hasRecordDetailValue } = await import("./RecordReadView");

const field = (overrides: Partial<Field> & Pick<Field, "id" | "name" | "type">): Field => ({
  shortId: overrides.id.slice(0, 6),
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
  test("renders a compact DetailPanel with titled icon sections and omits empty long-form sections", () => {
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

    expect(html).toContain("k2b-detail-panel__header");
    expect(html).toContain("k2b-detail-panel__body");
    expect(html).toContain("ti-table-row");
    expect(html).toContain("Studio shelf");
    expect(html).toContain("Fields");
    expect(html).toContain("ti-list-details");
    expect(html).toContain("Room");
    expect(html).not.toContain(">Notes<");
    expect(html).not.toContain("detail-stack");
    expect(html).not.toContain("detail-section-label");
  });

  test("groups relations with additional reverse-relation content", () => {
    const name = field({ id: "name", name: "Name", type: "text", presentable: true });
    const relation = field({ id: "camera", name: "Camera", type: "relation", config: { targetTableId: "cameras" } });
    const html = renderToString(() =>
      createComponent(RecordReadView, {
        baseId: "base",
        tableId: "table",
        tableName: "Loans",
        fields: [name, relation],
        record: record({ name: "Loan", camera: ["CAM001"] }),
        relationLabels: { CAM001: "Sony FX3" },
        relationsAfter: "Referenced by content",
      }),
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Record relationships"');
    expect(html).toContain("Relations");
    expect(html).toContain("Sony FX3");
    expect(html).toContain("Referenced by content");
    expect(html).not.toContain("Unknown record");
    expect(html).not.toContain("No record values yet");
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
