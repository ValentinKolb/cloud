import { describe, expect, test } from "bun:test";
import { shouldReloadWorkspaceForPopState } from "./workspace-route-ownership";

describe("shouldReloadWorkspaceForPopState", () => {
  const tablePath = "/app/grids/base/table/table-a";
  const viewPath = `${tablePath}/view/view-a`;
  const location = (href: string) => new URL(href, "http://grids.local");

  test("leaves query-only changes on the rendered records route to RecordsView", () => {
    expect(shouldReloadWorkspaceForPopState("records", tablePath, location(`${tablePath}?q=active&record=record-a`))).toBe(false);
    expect(shouldReloadWorkspaceForPopState("records", viewPath, location(`${viewPath}?sort=name&cursor=next`))).toBe(false);
  });

  test("reloads workspace state when navigating to another table", () => {
    expect(shouldReloadWorkspaceForPopState("records", tablePath, location("/app/grids/base/table/table-b"))).toBe(true);
  });

  test("reloads workspace state when entering or leaving a view", () => {
    expect(shouldReloadWorkspaceForPopState("records", tablePath, location(viewPath))).toBe(true);
    expect(shouldReloadWorkspaceForPopState("records", viewPath, location(tablePath))).toBe(true);
  });

  test("reloads workspace state for another route path", () => {
    expect(shouldReloadWorkspaceForPopState("records", tablePath, location("/app/grids/base/dashboard/overview"))).toBe(true);
  });

  test("keeps workspace ownership for non-record routes", () => {
    const dashboardPath = "/app/grids/base/dashboard/overview";
    expect(shouldReloadWorkspaceForPopState("dashboard", dashboardPath, location(`${dashboardPath}?edit=true`))).toBe(true);
  });

  test("reloads conservatively before the rendered pathname is known", () => {
    expect(shouldReloadWorkspaceForPopState("records", null, location(tablePath))).toBe(true);
  });
});
