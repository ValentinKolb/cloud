import { describe, expect, test } from "bun:test";
import { parseWorkspaceHref } from "./workspace";

describe("parseWorkspaceHref", () => {
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
});
