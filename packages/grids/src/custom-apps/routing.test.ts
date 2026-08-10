import { describe, expect, test } from "bun:test";
import type { CustomAppDefinition } from "./contracts";
import {
  customAppActionHref,
  customAppActionUrl,
  customAppCommentsUrl,
  customAppFormSubmitUrl,
  customAppFormSuccessHref,
  customAppPageHref,
  customAppRecordUpdateUrl,
  customAppRowHref,
  resolveCustomAppPage,
  resolveCustomAppPageParams,
  resolvePageRecordId,
} from "./routing";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const definition: CustomAppDefinition = {
  schemaVersion: 2,
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
      rows: [
        {
          id: "main",
          columns: [{ id: "content", span: 12, blocks: [{ id: "record", type: "record", fieldIds: [uuid(4)], editableFieldIds: [] }] }],
        },
      ],
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
    expect(resolveCustomAppPageParams(page, { request_id: uuid(9) })).toEqual({ request_id: uuid(9) });
    expect(resolveCustomAppPageParams(page, { request_id: "bad" })).toBeNull();
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

  test("builds internal Form submit and replace-navigation targets", () => {
    expect(customAppFormSubmitUrl("abc12", "detail", "edit", { request_id: uuid(9) })).toBe(
      `/api/grids/apps/runtime/abc12/detail/edit/submit?request_id=${uuid(9)}`,
    );
    expect(
      customAppFormSuccessHref(
        "abc12",
        { kind: "navigate", pageId: "detail", params: { request_id: { source: "RESULT", path: "recordId" } } },
        {},
        uuid(10),
      ),
    ).toBe(`/apps/abc12/detail?request_id=${uuid(10)}`);
  });

  test("builds an internal Comments endpoint with the declared page parameters", () => {
    expect(customAppCommentsUrl("abc12", "detail", "discussion", { request_id: uuid(9) })).toBe(
      `/api/grids/apps/runtime/abc12/detail/discussion/comments?request_id=${uuid(9)}`,
    );
  });

  test("builds an internal Record update endpoint with the declared page parameters", () => {
    expect(customAppRecordUpdateUrl("abc12", "detail", "record", { request_id: uuid(9) })).toBe(
      `/api/grids/apps/runtime/abc12/detail/record/record?request_id=${uuid(9)}`,
    );
  });

  test("builds exact internal action targets", () => {
    expect(customAppActionUrl("abc12", "detail", "actions", "approve", { request_id: uuid(9) })).toBe(
      `/api/grids/apps/runtime/abc12/detail/actions/actions/approve?request_id=${uuid(9)}`,
    );
    expect(
      customAppActionHref(
        "abc12",
        {
          id: "open",
          label: "Open",
          kind: "navigate",
          pageId: "detail",
          history: "replace",
          params: { request_id: { source: "RECORD", path: "id" } },
        },
        {},
        uuid(9),
      ),
    ).toBe(`/apps/abc12/detail?request_id=${uuid(9)}`);
    expect(
      customAppActionHref(
        "abc12",
        {
          id: "open",
          label: "Open",
          kind: "navigate",
          pageId: "detail",
          history: "push",
          params: { request_id: { source: "PARAMS", path: "request_id" } },
        },
        {},
      ),
    ).toBeNull();
  });
});
