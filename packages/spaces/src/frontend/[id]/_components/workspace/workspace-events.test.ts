import { describe, expect, test } from "bun:test";
import { isDetailOnlySpacesNavigation } from "./workspace-events";
import { parseSpacesWorkspaceHref } from "./workspace-types";

const ORIGIN = "https://cloud.example";

describe("Spaces detail navigation classification", () => {
  test("enhances opening, replacing, and closing only the item parameter", () => {
    const list = "/app/spaces/one?view=list&status=active";
    expect(isDetailOnlySpacesNavigation(list, `${list}&item=item-1`, ORIGIN)).toBe(true);
    expect(isDetailOnlySpacesNavigation(`${list}&item=item-1`, `${list}&item=item-2`, ORIGIN)).toBe(true);
    expect(isDetailOnlySpacesNavigation(`${list}&item=item-1`, list, ORIGIN)).toBe(true);
  });

  test("leaves view, filter, path, and origin changes to document navigation", () => {
    const current = "/app/spaces/one?view=list&status=active&item=item-1";
    expect(isDetailOnlySpacesNavigation(current, "/app/spaces/one?view=kanban", ORIGIN)).toBe(false);
    expect(isDetailOnlySpacesNavigation(current, "/app/spaces/one?view=list&status=completed", ORIGIN)).toBe(false);
    expect(isDetailOnlySpacesNavigation(current, "/app/spaces/two?view=list", ORIGIN)).toBe(false);
    expect(isDetailOnlySpacesNavigation(current, "https://other.example/app/spaces/one?view=list", ORIGIN)).toBe(false);
  });
});

describe("Spaces workspace route parsing", () => {
  test("accepts workspace and settings routes with valid identifiers", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseSpacesWorkspaceHref(`/app/spaces/${id}`)).toEqual({ spaceId: id, settings: false });
    expect(parseSpacesWorkspaceHref(`/app/spaces/${id}/settings`)).toEqual({ spaceId: id, settings: true });
  });

  test("rejects malformed identifiers and unsupported nested routes", () => {
    expect(parseSpacesWorkspaceHref("/app/spaces/not-a-uuid")).toBeNull();
    expect(parseSpacesWorkspaceHref("/app/spaces/11111111-1111-4111-8111-111111111111/unknown")).toBeNull();
  });
});
