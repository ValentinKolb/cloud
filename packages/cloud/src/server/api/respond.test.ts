import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { respond } from "./respond";

describe("respond", () => {
  test("supports bounded transport and upstream failure statuses", async () => {
    for (const status of [413, 422, 502, 503, 504] as const) {
      const app = new Hono().get("/", (c) => respond(c, { ok: false, error: "PDF failed", status }));
      const response = await app.request("/");

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ message: "PDF failed" });
    }
  });
});
