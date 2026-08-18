import { describe, expect, it } from "bun:test";
import { CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES, parseCloudResourceClipboard, serializeCloudResourceClipboard } from "./resource-clipboard";

describe("Cloud resource clipboard contract", () => {
  it("round-trips one stable resource reference", () => {
    const ref = { type: "grids.record", id: "A8vcaK" };

    expect(
      parseCloudResourceClipboard(serializeCloudResourceClipboard({ cloudUrl: "https://cloud.example", ref }), "https://cloud.example"),
    ).toEqual(ref);
  });

  it("scopes references to the configured Cloud URL", () => {
    const value = serializeCloudResourceClipboard({
      cloudUrl: "https://first.cloud.example",
      ref: { type: "grids.record", id: "A8vcaK" },
    });

    expect(parseCloudResourceClipboard(value, "https://second.cloud.example")).toBeNull();
  });

  it("rejects unknown versions, fields, and invalid references", () => {
    expect(parseCloudResourceClipboard('{"version":2,"ref":{"type":"grids.record","id":"A8vcaK"}}', "https://cloud.example")).toBeNull();
    expect(
      parseCloudResourceClipboard(
        '{"version":1,"cloudUrl":"https://cloud.example","ref":{"type":"grids.record","id":"A8vcaK"},"title":"Camera"}',
        "https://cloud.example",
      ),
    ).toBeNull();
    expect(
      parseCloudResourceClipboard(
        '{"version":1,"cloudUrl":"https://cloud.example","ref":{"type":"record","id":"A8vcaK"}}',
        "https://cloud.example",
      ),
    ).toBeNull();
  });

  it("rejects malformed and oversized payloads", () => {
    expect(parseCloudResourceClipboard("not json", "https://cloud.example")).toBeNull();
    expect(parseCloudResourceClipboard("x".repeat(CLOUD_RESOURCE_CLIPBOARD_MAX_BYTES + 1), "https://cloud.example")).toBeNull();
  });
});
