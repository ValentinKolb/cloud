import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import "../ssr-test-plugin";
import type { OkWorkspaceState } from "./workspace-state-model";

const { default: GridsSidebar } = await import("./GridsSidebar");

const workflow = {
  id: "22222222-2222-4222-8222-222222222222",
  shortId: "FLOW1",
  name: "Send approved loan agreement",
  position: 0,
};

const workflowState = (): OkWorkspaceState =>
  ({
    kind: "ok",
    base: {
      id: "11111111-1111-4111-8111-111111111111",
      shortId: "BASE1",
      name: "Inventory",
    },
    adminModeRequested: false,
    canManageBase: false,
    canCreateTables: false,
    catalog: {
      dashboards: [],
      tables: [],
      viewsByTable: {},
      sidebarForms: [],
      sidebarDocumentTemplates: [],
      workflows: [workflow],
    },
    route: {
      kind: "workflows",
      activeWorkflow: workflow,
    },
  }) as unknown as OkWorkspaceState;

describe("GridsSidebar workflows", () => {
  test("uses workflow rows as the selector without a duplicate overview item", () => {
    const html = renderToString(() => createComponent(GridsSidebar, { state: workflowState() }));

    expect(html).toContain("Send approved loan agreement");
    expect(html).not.toContain(">Overview<");
    expect(html).toContain("/app/grids/BASE1/workflows/FLOW1");
  });

  test("shows workflow creation in the sidebar only for base admins in Edit mode", () => {
    const editableState = workflowState();
    editableState.adminModeRequested = true;
    editableState.canManageBase = true;

    const editableHtml = renderToString(() => createComponent(GridsSidebar, { state: editableState }));
    const readOnlyHtml = renderToString(() => createComponent(GridsSidebar, { state: workflowState() }));

    expect(editableHtml).toContain("New workflow");
    expect(readOnlyHtml).not.toContain("New workflow");
  });

  test("shows workflow creation before the first workflow exists", () => {
    const state = workflowState();
    state.adminModeRequested = true;
    state.canManageBase = true;
    state.catalog.workflows = [];
    state.route = { kind: "empty" };

    const html = renderToString(() => createComponent(GridsSidebar, { state }));

    expect(html).toContain("Workflows");
    expect(html).toContain("New workflow");
    expect(html).not.toContain("Add workflow");
  });
});
