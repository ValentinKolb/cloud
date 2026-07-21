import { describe, expect, test } from "bun:test";
import { projectSpaceLinks } from "./conversation-context";

const LINK_ID = "11111111-1111-4111-8111-111111111111";
const SPACE_ID = "22222222-2222-4222-8222-222222222222";
const links = [{ id: LINK_ID, space_id: SPACE_ID }];

describe("conversation Space link projection", () => {
  test("hides inaccessible targets from readers", () => {
    expect(projectSpaceLinks({ links, resolved: [], canWrite: false, available: true })).toEqual({ status: "ready", links: [] });
  });

  test("keeps only an opaque removable link for writers", () => {
    expect(projectSpaceLinks({ links, resolved: [], canWrite: true, available: true })).toEqual({
      status: "ready",
      links: [{ linkId: LINK_ID, space: null }],
    });
    expect(projectSpaceLinks({ links, resolved: [], canWrite: true, available: false })).toEqual({
      status: "unavailable",
      links: [{ linkId: LINK_ID, space: null }],
    });
  });
});
