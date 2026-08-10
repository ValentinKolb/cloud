import { describe, expect, test } from "bun:test";
import { customAppViewSourceHash } from "../custom-apps/insight-source";
import { executePublishedCustomAppQuery } from "./custom-app-runtime-query";

const uuid = "019fa000-0000-7000-8000-000000000001";

describe("published Custom App query execution", () => {
  test("rejects a source that differs from its immutable capability before compiling it", async () => {
    const response = await executePublishedCustomAppQuery({
      baseId: uuid,
      source: "not valid GQL",
      capability: { sourceHash: customAppViewSourceHash(uuid, "from table Expected"), planHash: "a".repeat(64), tableIds: [uuid] },
      context: {} as never,
      signal: new AbortController().signal,
      timeZone: "UTC",
      viewer: { userId: null, userGroups: [] },
      maxRows: 1,
      maxResultBytes: 1_024,
    });

    expect(response).toEqual({
      ok: false,
      diagnostics: [{ message: "This published data source no longer matches its capability snapshot." }],
    });
  });
});
