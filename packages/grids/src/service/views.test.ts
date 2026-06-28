import { test, expect, describe } from "bun:test";
import { isVisibleByAclTiers } from "./views";

const dflt = { ownerUserId: null, viewerUserId: "user-1" };

describe("isVisibleByAclTiers — most-specific-wins", () => {
  test("no ACL rows: shared view visible", () => {
    expect(
      isVisibleByAclTiers(
        { userRank: null, groupRank: null, authRank: null, publicRank: null },
        { ownerUserId: null, viewerUserId: "user-1" },
      ),
    ).toBe(true);
  });

  test("no ACL rows: own personal view visible", () => {
    expect(
      isVisibleByAclTiers(
        { userRank: null, groupRank: null, authRank: null, publicRank: null },
        { ownerUserId: "user-1", viewerUserId: "user-1" },
      ),
    ).toBe(true);
  });

  test("no ACL rows: someone else's personal view hidden", () => {
    expect(
      isVisibleByAclTiers(
        { userRank: null, groupRank: null, authRank: null, publicRank: null },
        { ownerUserId: "other", viewerUserId: "user-1" },
      ),
    ).toBe(false);
  });

  test("user:read grants visibility on someone else's personal view", () => {
    expect(
      isVisibleByAclTiers(
        { userRank: 1, groupRank: null, authRank: null, publicRank: null },
        { ownerUserId: "other", viewerUserId: "user-1" },
      ),
    ).toBe(true);
  });

  test("user:none hides shared view", () => {
    expect(isVisibleByAclTiers({ userRank: 0, groupRank: null, authRank: null, publicRank: null }, dflt)).toBe(false);
  });

  test("public:read + user:none → user wins (hidden)", () => {
    expect(isVisibleByAclTiers({ userRank: 0, groupRank: null, authRank: null, publicRank: 1 }, dflt)).toBe(false);
  });

  test("public:none + user:read → user wins (visible)", () => {
    expect(
      isVisibleByAclTiers({ userRank: 1, groupRank: null, authRank: null, publicRank: 0 }, { ownerUserId: null, viewerUserId: "user-1" }),
    ).toBe(true);
  });

  test("group:read + group:none on same tier → deny wins (rank 0 from same-tier-deny aggregation)", () => {
    // The SQL aggregation produces 0 when any deny exists in the tier;
    // the resolver doesn't see the individual rows.
    expect(isVisibleByAclTiers({ userRank: null, groupRank: 0, authRank: null, publicRank: null }, dflt)).toBe(false);
  });

  test("group:read + public:none → group wins (visible)", () => {
    expect(isVisibleByAclTiers({ userRank: null, groupRank: 1, authRank: null, publicRank: 0 }, dflt)).toBe(true);
  });

  test("authenticated:read on shared → visible", () => {
    expect(isVisibleByAclTiers({ userRank: null, groupRank: null, authRank: 1, publicRank: null }, dflt)).toBe(true);
  });

  test("authenticated:read + group:none → group wins (hidden)", () => {
    expect(isVisibleByAclTiers({ userRank: null, groupRank: 0, authRank: 1, publicRank: null }, dflt)).toBe(false);
  });
});
