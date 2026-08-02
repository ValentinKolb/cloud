import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { Field, Table } from "../../../service";
import { QUERY_PANEL_DIALOG_OPTIONS } from "../records-view/RecordsView";
import SearchBar from "../toolbar/SearchBar";
import QueryWorkspace from "./QueryWorkspace";

const table: Table = {
  id: "11111111-1111-4111-8111-111111111111",
  baseId: "22222222-2222-4222-8222-222222222222",
  shortId: "items",
  name: "Items",
  description: null,
  icon: null,
  kind: "stored",
  columns: [],
  displayConfig: { mode: "table" },
  auditPolicy: {},
  position: 0,
  disableDirectInsert: false,
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  deletedAt: null,
};

const field: Field = {
  id: "33333333-3333-4333-8333-333333333333",
  shortId: "name",
  tableId: table.id,
  name: "Name",
  description: null,
  icon: null,
  type: "text",
  required: false,
  presentable: true,
  hideInTable: false,
  position: 0,
  indexed: false,
  uniqueConstraint: false,
  defaultValue: null,
  config: {},
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  deletedAt: null,
};

describe("query workspace UI contracts", () => {
  test("keeps the fill editor tall and source fields compact", () => {
    const html = renderToString(() =>
      createComponent(QueryWorkspace, {
        baseId: table.baseId,
        baseShortId: "inventory",
        initialQuery: "",
        queryPath: "/app/grids/inventory/query",
        tables: [table],
        fieldsByTable: { [table.id]: [field] },
        viewsByTable: {},
      }),
    );

    expect(html).toContain('class="k2b-field " data-fill="true"');
    expect(html).toContain("text-[10px] leading-tight");
    expect(html).toContain("text-[9px] text-dimmed");
  });

  test("uses the semantic wide panel dialog contract", () => {
    expect(QUERY_PANEL_DIALOG_OPTIONS.panelClassName).toContain("is-wide");
    expect(QUERY_PANEL_DIALOG_OPTIONS.panelClassName).not.toContain("w-[");
  });

  test("separates search scope labels from field types", () => {
    const html = renderToString(() =>
      createComponent(SearchBar, {
        fields: [field],
        initialQ: "",
        initialQFields: [],
        onSearchChange: () => undefined,
      }),
    );

    expect(html).toContain('<strong class="truncate">Name</strong>');
    expect(html).toContain('<small class="shrink-0 text-dimmed">text</small>');
  });
});
