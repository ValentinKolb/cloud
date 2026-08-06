import { describe, expect, test } from "bun:test";
import type { CustomAppDefinition } from "./contracts";
import { customAppPageHref, customAppRowHref, resolveCustomAppPage, resolvePageRecordId } from "./routing";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const definition: CustomAppDefinition = {
  schemaVersion: 1,
  kind: "grids.custom-app",
  id: uuid(1),
  baseId: uuid(2),
  name: "Requests",
  startPageId: "home",
  pages: [
    {
      id: "home",
      title: "Requests",
      navigation: { visible: true, order: 0 },
      parameters: {},
      rows: [{ id: "main", columns: [{ id: "content", span: 12, blocks: [{ id: "copy", type: "markdown", markdown: "Hello" }] }] }],
    },
    {
      id: "detail",
      title: "Request",
      navigation: { visible: false, order: 10 },
      parameters: { request_id: { type: "record", tableId: uuid(3), required: true } },
      record: { tableId: uuid(3), id: { source: "PARAMS", path: "request_id" } },
      rows: [{ id: "main", columns: [{ id: "content", span: 12, blocks: [{ id: "record", type: "record", fieldIds: [uuid(4)] }] }] }],
    },
  ],
};

describe("Custom App routing", () => {
  test("uses the start page and resolves an explicit route-only page", () => {
    expect(resolveCustomAppPage(definition)?.id).toBe("home");
    expect(resolveCustomAppPage(definition, "detail")?.id).toBe("detail");
    expect(resolveCustomAppPage(definition, "missing")).toBeNull();
  });

  test("accepts only a valid page record id", () => {
    const page = definition.pages[1]!;
    expect(resolvePageRecordId(page, { request_id: uuid(9) })).toBe(uuid(9));
    expect(resolvePageRecordId(page, { request_id: "not-a-record" })).toBeNull();
    expect(resolvePageRecordId(page, {})).toBeNull();
    expect(resolvePageRecordId(definition.pages[0]!, {})).toBeUndefined();
  });

  test("builds stable page and row navigation URLs", () => {
    expect(customAppPageHref("abc12", "detail", { request_id: uuid(9) })).toBe(`/apps/abc12/detail?request_id=${uuid(9)}`);
    expect(
      customAppRowHref(
        "abc12",
        { kind: "navigate", pageId: "detail", history: "push", params: { request_id: { source: "ROW", path: "id" } } },
        uuid(9),
      ),
    ).toBe(`/apps/abc12/detail?request_id=${uuid(9)}`);
  });
});
