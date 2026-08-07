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
      customApps: [],
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

describe("GridsSidebar Custom Apps", () => {
  test("links base-admin builders and marks drafts", () => {
    const state = workflowState();
    state.canManageBase = true;
    state.catalog.customApps = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        shortId: "APP1",
        baseId: state.base.id,
        name: "Loan desk",
        icon: "clipboard",
        publishedAt: null,
        updatedAt: "2026-08-07T00:00:00.000Z",
      },
    ];
    state.route = { kind: "customApp", app: { id: state.catalog.customApps[0]!.id } } as OkWorkspaceState["route"];

    const html = renderToString(() => createComponent(GridsSidebar, { state }));

    expect(html).toContain("Custom Apps");
    expect(html).toContain("Loan desk");
    expect(html).toContain("/app/grids/BASE1/apps/APP1?edit=true");
    expect(html).toContain("draft");
  });
});
