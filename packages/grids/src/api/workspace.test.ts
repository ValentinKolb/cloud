import { describe, expect, test } from "bun:test";
import { parseWorkspaceHref } from "./workspace";

describe("parseWorkspaceHref", () => {
  test("accepts the base and query workspace routes", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc")).toMatchObject({ baseShortId: "hNTsc" });
    expect(parseWorkspaceHref("/app/grids/hNTsc/query?table=tbl123")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: null,
    });
  });

  test("accepts table and view workspace routes", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: null,
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/query")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: null,
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/view/view456")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: "view456",
    });
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/view/view456/query")).toMatchObject({
      baseShortId: "hNTsc",
      activeTableSlug: "tbl123",
      activeViewSlug: "view456",
    });
  });

  test("accepts dashboard and document workspace routes", () => {
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

  test("rejects incomplete, trailing, and non-workspace paths", () => {
    expect(parseWorkspaceHref("/app/grids/hNTsc/table")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/table/tbl123/view")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/dashboard")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/document/tbl123")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/query/extra")).toBeNull();
    expect(parseWorkspaceHref("/app/grids/hNTsc/reference")).toBeNull();
    expect(parseWorkspaceHref("/app/notebooks/hNTsc")).toBeNull();
  });
});
