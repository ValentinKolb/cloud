import { describe, expect, test } from "bun:test";
import { parseWorkspaceHref } from "./workspace";

describe("parseWorkspaceHref", () => {
  test("accepts table, view, query, dashboard, and document routes", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: null,
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/view/view456/query")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: "view456",
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/dashboard/dash123")).toMatchObject({
      baseShortId: "hNTsc",
      activeDashboardSlug: "dash123",
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/document/tbl123/tpl456")).toMatchObject({
      baseShortId: "hNTsc",
      activeDocumentTableSlug: "tbl123",
      activeDocumentTemplateSlug: "tpl456",
    });
  });

  test("accepts workflow overview routes with edit mode", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/workflows?edit=true")).toEqual({
      baseShortId: "hNTsc",
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeWorkflowSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    });
  });

  test("accepts workflow detail routes with edit mode", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/workflows/wf123?edit=true")).toEqual({
      baseShortId: "hNTsc",
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeWorkflowSlug: "wf123",
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    });
  });

  test("rejects removed automation routes", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/automations?edit=true")).toBeNull();
  });

  test("rejects removed scanner routes", () => {
    expect(parseWorkspaceHref("/app/grids/scan")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/workflows/wf123/scan")).toBeNull();
  });
});
