import { describe, expect, test } from "bun:test";
import { CAPABILITY_MAX_RESULT_BYTES } from "@valentinkolb/cloud/contracts";
import { readCapabilityOutcome } from "./invocation";

describe("capability invocation responses", () => {
  test("accepts a valid capability result", async () => {
    const response = new Response(JSON.stringify({ data: { id: "contact-1" }, refs: [{ type: "contacts.contact", id: "contact-1" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const outcome = await readCapabilityOutcome(response, 12.5);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.data).toEqual({ id: "contact-1" });
  });

  test("preserves structured application errors", async () => {
    const response = new Response(
      JSON.stringify({ code: "CONFLICT", message: "The contact already exists.", details: { field: "email" } }),
      {
        status: 409,
      },
    );
    const outcome = await readCapabilityOutcome(response, 4);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok)
      expect(outcome.error).toEqual({ code: "CONFLICT", message: "The contact already exists.", details: { field: "email" } });
  });

  test("turns an HTML proxy failure into a safe transport error", async () => {
    const outcome = await readCapabilityOutcome(new Response("<html>bad gateway</html>", { status: 502 }), 8);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INVALID_APP_RESPONSE");
      expect(outcome.error.message).toBe("The capability request failed with HTTP 502.");
    }
  });

  test("rejects malformed success payloads", async () => {
    const outcome = await readCapabilityOutcome(new Response(JSON.stringify({ unexpected: true }), { status: 200 }), 2);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("INVALID_APP_RESPONSE");
  });

  test("rejects an oversized response before parsing it", async () => {
    const outcome = await readCapabilityOutcome(new Response("x".repeat(CAPABILITY_MAX_RESULT_BYTES + 1)), 2);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("RESPONSE_TOO_LARGE");
  });
});
