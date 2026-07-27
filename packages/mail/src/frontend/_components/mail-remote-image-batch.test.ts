import { describe, expect, test } from "bun:test";
import { mergeMailRemoteImageUrls } from "./mail-remote-image-batch";

describe("Mail remote image batches", () => {
  test("commits a complete load batch without mutating the current map", () => {
    const current = new Map([["existing", "blob:existing"]]);
    const next = mergeMailRemoteImageUrls(current, [
      ["first", "blob:first"],
      ["second", "blob:second"],
    ]);

    expect([...current]).toEqual([["existing", "blob:existing"]]);
    expect([...next]).toEqual([
      ["existing", "blob:existing"],
      ["first", "blob:first"],
      ["second", "blob:second"],
    ]);
  });
});
