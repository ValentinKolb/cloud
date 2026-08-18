import { describe, expect, it } from "bun:test";
import { CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES, parseCloudResourceClipboard, serializeCloudResourceClipboard } from "./resource-clipboard";

describe("Cloud resource clipboard contract", () => {
  it("round-trips one stable resource reference", () => {
    const ref = { type: "grids.record", id: "A8vcaK" };

    expect(parseCloudResourceClipboard(serializeCloudResourceClipboard(ref))).toEqual(ref);
  });

  it("rejects unknown versions, fields, and invalid references", () => {
    expect(parseCloudResourceClipboard('{"version":2,"ref":{"type":"grids.record","id":"A8vcaK"}}')).toBeNull();
    expect(parseCloudResourceClipboard('{"version":1,"ref":{"type":"grids.record","id":"A8vcaK"},"title":"Camera"}')).toBeNull();
    expect(parseCloudResourceClipboard('{"version":1,"ref":{"type":"record","id":"A8vcaK"}}')).toBeNull();
  });

  it("rejects malformed and oversized payloads", () => {
    expect(parseCloudResourceClipboard("not json")).toBeNull();
    expect(parseCloudResourceClipboard("x".repeat(CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES + 1))).toBeNull();
  });
});
