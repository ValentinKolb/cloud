import { describe, expect, test } from "bun:test";
import {
  PULSE_EVENT_ATTRIBUTES_MAX_BYTES,
  validateDimensions,
  validateEventAttributes,
  validateEventPayload,
} from "./telemetry-contract";

describe("Pulse telemetry contract", () => {
  test("accepts bounded dimensions and nested high-cardinality attributes", () => {
    expect(validateDimensions({ campaign: "summer", country: "DE" })).toBeNull();
    expect(
      validateEventAttributes({
        url: "https://example.com/pricing?request=unique",
        request_id: "request-unique",
        geo: { city: "Berlin", latitude: 52.52, longitude: 13.405 },
      }),
    ).toBeNull();
  });

  test("rejects oversized attributes and invalid JSON values", () => {
    expect(validateEventAttributes({ value: "x".repeat(PULSE_EVENT_ATTRIBUTES_MAX_BYTES) })).toContain("cannot exceed");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateEventPayload(cyclic)).toBe("Event payload must be valid JSON");
  });
});
