import { describe, expect, test } from "bun:test";
import { ok } from "@k2b/stdlib";
import { projectDeletedLocalTag } from "./local-tags";

describe("Mail local tag API projection", () => {
  test("returns the validated public tag ID after deletion", async () => {
    expect(await projectDeletedLocalTag(Promise.resolve(ok()), "tag123")).toEqual(ok({ id: "tag123" }));
  });
});
