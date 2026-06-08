import { describe, expect, test } from "bun:test";
import { selectStaleLocalIpaRows } from "./sync-planning";

describe("selectStaleLocalIpaRows", () => {
  test("keeps unchanged active IPA users out of stale transitions", () => {
    const stale = selectStaleLocalIpaRows({
      localRows: [{ uid: "eva", mail: "eva@example.test" }],
      activeRemoteUsers: [{ uid: "eva", mail: "eva@example.test" }],
    });

    expect(stale).toEqual([]);
  });

  test("keeps UID-renamed IPA users out of stale transitions when mail still matches", () => {
    const stale = selectStaleLocalIpaRows({
      localRows: [{ uid: "old-eva", mail: "eva@example.test" }],
      activeRemoteUsers: [{ uid: "new-eva", mail: "eva@example.test" }],
    });

    expect(stale).toEqual([]);
  });

  test("returns IPA users with no active UID or mail match as stale", () => {
    const local = { uid: "old-eva", mail: "old-eva@example.test" };
    const stale = selectStaleLocalIpaRows({
      localRows: [local],
      activeRemoteUsers: [{ uid: "new-eva", mail: "eva@example.test" }],
    });

    expect(stale).toEqual([local]);
  });
});
