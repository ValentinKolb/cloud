import { describe, expect, test } from "bun:test";
import { selectUidBatch } from "./imap-smtp";

const sparseSearch = (uids: number[], probes: Array<[number, number]>) => async (lowUid: number, highUid: number) => {
  probes.push([lowUid, highUid]);
  return uids.filter((uid) => uid >= lowUid && uid <= highUid);
};

describe("IMAP envelope UID batching", () => {
  test("finds existing messages without scanning every sparse UID window", async () => {
    const probes: Array<[number, number]> = [];
    const first = await selectUidBatch({
      lowUid: 1,
      highUid: 10_000_000,
      limit: 2,
      search: sparseSearch([3, 100, 9_999_999], probes),
    });
    expect(first).toEqual({ uids: [100, 9_999_999], nextHighUid: 99 });
    expect(probes.length).toBeLessThanOrEqual(12);

    const second = await selectUidBatch({
      lowUid: 1,
      highUid: first.nextHighUid!,
      limit: 2,
      search: sparseSearch([3, 100, 9_999_999], []),
    });
    expect(second).toEqual({ uids: [3], nextHighUid: null });
  });

  test("returns the newest dense batch and a stable continuation", async () => {
    const all = Array.from({ length: 1_000 }, (_, index) => index + 1);
    const result = await selectUidBatch({
      lowUid: 1,
      highUid: 1_000,
      limit: 200,
      search: sparseSearch(all, []),
    });
    expect(result.uids).toEqual(Array.from({ length: 200 }, (_, index) => index + 801));
    expect(result.nextHighUid).toBe(800);
  });
});
