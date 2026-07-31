import { describe, expect, test } from "bun:test";
import { readBoundedJson } from "./bounded-json";

describe("readBoundedJson", () => {
  test("parses JSON within the actual byte limit", async () => {
    const result = await readBoundedJson(new Request("http://cloud.test", { method: "POST", body: '{"ok":true}' }), 32);
    expect(result).toEqual({ ok: true, data: { ok: true } });
  });

  test("rejects invalid and streamed oversized JSON", async () => {
    expect(await readBoundedJson(new Response("{"), 32)).toEqual({ ok: false, reason: "invalid_json" });
    expect(await readBoundedJson(new Response(JSON.stringify({ value: "x".repeat(64) })), 32)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});
