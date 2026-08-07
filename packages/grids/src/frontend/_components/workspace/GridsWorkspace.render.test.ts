import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import "../ssr-test-plugin";
import type { OkWorkspaceState } from "./workspace-state-model";

const { default: GridsWorkspace } = await import("./GridsWorkspace");

const workspaceState = (): OkWorkspaceState => ({
  kind: "ok",
  base: {
    id: "12345678-abcd-4000-8000-000000000000",
    shortId: "demo1",
    name: "Inventory",
    description: null,
    documentProfile: {},
    createdBy: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  baseShortId: "demo1",
  title: [{ title: "Inventory" }],
  rememberPath: "/app/grids/demo1",
  adminModeRequested: false,
  editModeToggleHref: "/app/grids/demo1?edit=true",
  canManageBase: false,
  canCreateTables: false,
  canUseEditMode: false,
  canUseQueryWorkspace: false,
  metadataEventCursor: null,
  recordEventCursor: null,
  catalog: {
    workflows: [],
    workflowLevels: {},
    tables: [],
    tableLevels: {},
    fieldsByTable: {},
    viewsByTable: {},
    formsByTable: {},
    documentTemplatesByTable: {},
    documentTemplateLevels: {},
    tableShortIds: {},
    sidebarForms: [],
    sidebarDocumentTemplates: [],
  },
  route: { kind: "empty" },
});

describe("GridsWorkspace", () => {
  test("owns one content shell outside the interactive route island", () => {
    const html = renderToString(() =>
      createComponent(GridsWorkspace, {
        state: workspaceState(),
      }),
    );

    expect(html.match(/k2b-app-workspace__content/g)).toHaveLength(1);

    const contentClass = html.indexOf("k2b-app-workspace__content");
    const contentStart = html.lastIndexOf("<div", contentClass);
    const contentTagEnd = html.indexOf(">", contentClass);
    const routeIsland = html.indexOf("<solid-island", contentTagEnd);

    expect(contentStart).toBeGreaterThan(-1);
    expect(routeIsland).toBeGreaterThan(contentTagEnd);
    expect(html.slice(contentTagEnd + 1, routeIsland).trim()).toBe("");
  });
});
