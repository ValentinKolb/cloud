import { describe, expect, test } from "bun:test";
import { readResponseError } from "./response";

describe("readResponseError", () => {
  test("returns an API message when present", async () => {
    const response = new Response(JSON.stringify({ message: "Status cannot be deleted" }), {
      headers: { "content-type": "application/json" },
      status: 400,
    });

    expect(await readResponseError(response, "Request failed")).toBe("Status cannot be deleted");
  });

  test("uses stable user copy for non-JSON upstream failures", async () => {
    const response = new Response("Bad Gateway", { status: 502 });

    expect(await readResponseError(response, "Could not load workspace route")).toBe("Could not load workspace route");
  });
});
